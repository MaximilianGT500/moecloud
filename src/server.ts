import { config } from './config.ts';
import { closeDatabase, openDatabase, updateBackup } from './lib/db.ts';
import { buildApp } from './app.ts';
import { ensureDirs } from './services/blobs.ts';
import { startJobs } from './services/jobs.ts';
import { detectTools } from './services/media.ts';
import { refreshPreviews, startProcessing } from './services/processing.ts';
import * as settings from './services/settings.ts';
import { isSetUp, setupCode } from './services/setup.ts';

await ensureDirs();
openDatabase(config.paths.db, config.paths.backups);
settings.secret();

const app = await buildApp();
if (updateBackup) app.log.info(`Vor dem Update der Datenbank wurde eine Sicherung angelegt: ${updateBackup}`);

const found = await detectTools();
const missing = Object.entries(found)
  .filter(([, available]) => !available)
  .map(([name]) => name);
if (missing.length) app.log.info(`Ohne ${missing.join(', ')} gibt es weniger Vorschaubilder und keine Volltextsuche in PDFs`);

const refreshed = refreshPreviews();
if (refreshed?.pending) app.log.info(`${refreshed.pending} Dateien bekommen im Hintergrund neue Vorschauen`);

process.on('unhandledRejection', (reason) => app.log.error(reason, 'Unbehandelter Fehler'));

const stopJobs = startJobs(app.log);
const stopProcessing = startProcessing();

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error, 'MoeCloud konnte nicht starten');
  process.exit(1);
}

app.log.info(`MoeCloud ${config.version} läuft auf Port ${config.port}, Daten liegen in ${config.dataDir}`);

if (!isSetUp()) {
  const base = (settings.get('site.url') || config.publicUrl || `http://localhost:${config.port}`).replace(/\/+$/, '');
  app.log.info(`MoeCloud ist noch nicht eingerichtet. Öffne ${base}/setup?code=${setupCode()} im Browser.`);
}

if (settings.get('maintenance.enabled')) app.log.warn('Der Wartungsmodus ist an, nur Admins kommen hinein');

let closing = false;

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} empfangen, MoeCloud fährt herunter`);
  const timer = setTimeout(() => process.exit(1), 18_000);
  timer.unref();
  stopJobs();
  stopProcessing();
  try {
    await app.close();
  } finally {
    closeDatabase();
    clearTimeout(timer);
    process.exit(0);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
