import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './src/config.ts';
import { all, closeDatabase, openDatabase, run, stamp, vacuumInto } from './src/lib/db.ts';
import { hashPassword, randomId } from './src/lib/crypto.ts';
import { audit } from './src/services/audit.ts';
import { blobPath, ensureDirs } from './src/services/blobs.ts';
import { resetTotp } from './src/services/auth.ts';
import { runMaintenance } from './src/services/jobs.ts';
import { deliver, mailReady } from './src/services/mail.ts';
import { detectTools } from './src/services/media.ts';
import { pendingCount, processNow, reindexText } from './src/services/processing.ts';
import { job, rescan, testScanner } from './src/services/scan.ts';
import { destroyUserSessions } from './src/services/sessions.ts';
import * as settings from './src/services/settings.ts';
import { isSetUp, renewSetupCode, setupCode } from './src/services/setup.ts';
import { checkForUpdates } from './src/services/updates.ts';
import { createUser, findByUsername, listUsers, usageOf } from './src/services/users.ts';

const command = process.env.MOECLOUD_COMMAND || 'node cli.ts';
const [name, ...args] = process.argv.slice(2);

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw error;
});

const out = (line = '') => process.stdout.write(`${line}\n`);
const fail = (line: string): never => {
  process.stderr.write(`${line}\n`);
  process.exit(1);
};

function option(key: string) {
  const index = args.indexOf(`--${key}`);
  return index >= 0 ? args[index + 1] : undefined;
}

const positional = () => args.filter((arg, index) => !arg.startsWith('--') && !(index > 0 && args[index - 1].startsWith('--')));

function size(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function help() {
  const lines: [string, string][] = [
    ['users', 'Alle Konten anzeigen'],
    ['create-admin <name> [--email] [--name]', 'Admin-Konto mit neuem Passwort anlegen'],
    ['reset-password <name>', 'Neues Passwort setzen und alle Sitzungen beenden'],
    ['reset-2fa <name> [--passkeys]', 'Authenticator-App entfernen, mit --passkeys auch alle Passkeys'],
    ['setup-link [--new]', 'Link für die Einrichtung anzeigen, mit --new einen neuen Code erzeugen'],
    ['backup [ordner]', 'Datenbank sichern, ohne den Server anzuhalten'],
    ['cleanup', 'Papierkorb, Uploads und verwaiste Dateien aufräumen'],
    ['check', 'Prüfen, ob alle Dateien auf der Platte liegen'],
    ['maintenance <on|off> [text]', 'Wartungsmodus ein- oder ausschalten'],
    ['scan-test', 'Verbindung zu ClamAV prüfen'],
    ['scan [--all]', 'Ungeprüfte Dateien mit ClamAV prüfen, mit --all alle'],
    ['mail-test <adresse>', 'Test-E-Mail schicken'],
    ['process', 'Vorschaubilder, Metadaten und Suchindex nachholen'],
    ['reindex', 'Suchindex für Inhalte neu aufbauen'],
    ['version', 'Installierte und neueste Version anzeigen'],
  ];
  out('MoeCloud Kommandozeile');
  out();
  for (const [usage, text] of lines) out(`  ${command} ${usage.padEnd(40)} ${text}`);
}

function requireUser(username: string | undefined) {
  if (!username) fail('Gib einen Benutzernamen an.');
  const user = findByUsername(username!);
  if (!user) fail(`Das Konto „${username}“ gibt es nicht.`);
  return user!;
}

const generated = () => randomId(20);

async function main() {
  await ensureDirs();
  openDatabase(config.paths.db, config.paths.backups);
  switch (name) {
    case 'users': {
      const users = listUsers();
      if (users.length === 0) out('Es gibt noch keine Konten.');
      for (const user of users) {
        const flags = [
          user.role === 'admin' ? 'Admin' : 'Mitglied',
          user.disabled ? 'gesperrt' : '',
          user.totp_enabled ? '2FA' : '',
        ].filter(Boolean);
        out(`${user.username.padEnd(24)} ${user.name.padEnd(28)} ${size(usageOf(user.id)).padStart(10)}  ${flags.join(', ')}`);
      }
      break;
    }
    case 'create-admin': {
      const [username] = positional();
      if (!username) fail('Gib einen Benutzernamen an.');
      const password = generated();
      await createUser({ username, name: option('name') ?? username, email: option('email') ?? null, password, role: 'admin' });
      if (!settings.get('setup.done')) settings.set('setup.done', true);
      out(`Das Admin-Konto „${username}“ ist angelegt.`);
      out(`Passwort: ${password}`);
      out('Ändere es nach der ersten Anmeldung unter Konto › Sicherheit.');
      break;
    }
    case 'reset-password': {
      const user = requireUser(positional()[0]);
      const password = generated();
      run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(password), user.id);
      destroyUserSessions(user.id);
      out(`Neues Passwort für „${user.username}“: ${password}`);
      break;
    }
    case 'reset-2fa': {
      const user = requireUser(positional()[0]);
      resetTotp(user.id);
      if (args.includes('--passkeys')) {
        const removed = run('DELETE FROM passkeys WHERE user_id = ?', user.id).changes;
        audit('admin_2fa_reset', { subject: user.id, details: { totp: true, passkeys: removed, via: 'cli' } });
        out(`Die Authenticator-App und ${removed} Passkeys von „${user.username}“ sind entfernt.`);
      } else {
        audit('admin_2fa_reset', { subject: user.id, details: { via: 'cli' } });
        out(`Die Authenticator-App von „${user.username}“ ist entfernt. Passkeys bleiben erhalten, --passkeys entfernt auch sie.`);
      }
      break;
    }
    case 'setup-link': {
      if (isSetUp()) fail('MoeCloud ist schon eingerichtet.');
      const code = args.includes('--new') ? renewSetupCode() : setupCode();
      const base = (settings.get('site.url') || config.publicUrl || `http://localhost:${config.port}`).replace(/\/+$/, '');
      out(`${base}/setup?code=${code}`);
      break;
    }
    case 'backup': {
      const dir = positional()[0] ?? config.paths.backups;
      await mkdir(dir, { recursive: true });
      const file = vacuumInto(join(dir, `moecloud-manual-${stamp()}.db`));
      audit('backup_created', { details: { name: file, via: 'cli' } });
      out(`Datenbank gesichert: ${file} (${size((await stat(file)).size)})`);
      out(`Sichere zusätzlich den Ordner ${config.paths.blobs}, dort liegen die Dateien.`);
      break;
    }
    case 'cleanup': {
      const result = await runMaintenance();
      out(
        `Papierkorb: ${result.trash} · Uploads: ${result.uploads} · Dateien: ${result.blobs} · Temporär: ${result.tmp} · Sitzungen: ${result.sessions}`
      );
      break;
    }
    case 'check': {
      const rows = all<{ sha256: string }>('SELECT sha256 FROM blobs WHERE refs > 0');
      let missing = 0;
      for (const row of rows) {
        const exists = await stat(blobPath(row.sha256)).catch(() => null);
        if (!exists) {
          missing++;
          out(`Fehlt: ${row.sha256}`);
        }
      }
      out(missing ? `${missing} von ${rows.length} Dateien fehlen auf der Platte.` : `Alle ${rows.length} Dateien sind da.`);
      if (missing) process.exitCode = 2;
      break;
    }
    case 'maintenance': {
      const [state, ...text] = positional();
      if (state !== 'on' && state !== 'off') fail('Gib on oder off an.');
      settings.set('maintenance.enabled', state === 'on');
      if (text.length) settings.set('maintenance.message', text.join(' '));
      audit('maintenance', { details: { enabled: state === 'on', via: 'cli' } });
      out(state === 'on' ? 'Der Wartungsmodus ist an. Nur Admins kommen hinein.' : 'Der Wartungsmodus ist aus.');
      break;
    }
    case 'scan-test': {
      try {
        const result = await testScanner();
        out(`${result.version} (${result.ms} ms)`);
        out(result.detects ? `Die Testsignatur wurde erkannt: ${result.signature}` : 'Die Testsignatur wurde nicht erkannt.');
        if (!result.detects) process.exitCode = 2;
      } catch (error) {
        fail(`ClamAV ist nicht erreichbar: ${(error as Error).message}`);
      }
      break;
    }
    case 'scan': {
      if (!settings.get('scan.enabled')) fail('Der Virenscan ist ausgeschaltet. Schalte ihn unter Admin › Virenscan ein.');
      rescan(args.includes('--all'));
      while (job.running) {
        process.stdout.write(`\rGeprüft: ${job.done} von ${job.total}, Funde: ${job.found}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      out(`\rGeprüft: ${job.done} von ${job.total}, Funde: ${job.found}`);
      if (job.found) process.exitCode = 2;
      break;
    }
    case 'mail-test': {
      const [to] = positional();
      if (!to) fail('Gib eine E-Mail-Adresse an.');
      if (!mailReady()) fail('Der E-Mail-Versand ist nicht eingerichtet. Das geht unter Admin › E-Mail.');
      try {
        await deliver(to, {
          lang: settings.get('site.language'),
          title: `Test von ${settings.get('site.name')}`,
          lines: ['Diese E-Mail zeigt, dass der Versand funktioniert.'],
        });
        out(`Die Test-E-Mail ist an ${to} unterwegs.`);
      } catch (error) {
        fail(`Der Versand hat nicht geklappt: ${(error as Error).message}`);
      }
      break;
    }
    case 'process':
    case 'reindex': {
      await detectTools();
      if (name === 'reindex') reindexText();
      const total = pendingCount();
      out(`${total} Dateien in der Warteschlange.`);
      await processNow();
      out('Fertig.');
      break;
    }
    case 'version': {
      out(`Installiert: MoeCloud ${config.version}`);
      try {
        const status = await checkForUpdates(true);
        if (status.latest) out(`Neueste Version: ${status.latest.version}${status.available ? ' (Update verfügbar)' : ''}`);
      } catch (error) {
        out(`Die neueste Version ließ sich nicht abrufen: ${(error as Error).message}`);
      }
      break;
    }
    default:
      help();
      if (name && name !== 'help') process.exitCode = 1;
  }
  closeDatabase();
}

await main();
