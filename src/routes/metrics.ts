import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { safeEqual } from '../lib/crypto.ts';
import { databaseInfo, value } from '../lib/db.ts';
import { liveCount } from '../lib/events.ts';
import { notFound, unauthorized } from '../lib/errors.ts';
import { pendingCount } from '../services/processing.ts';
import { scanStats } from '../services/scan.ts';
import * as settings from '../services/settings.ts';

const line = (name: string, help: string, type: 'gauge' | 'counter', samples: [Record<string, string> | null, number][]) =>
  [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${type}`,
    ...samples.map(([labels, sample]) => {
      const tags = labels
        ? `{${Object.entries(labels)
            .map(([key, entry]) => `${key}="${entry.replace(/["\\\n]/g, '_')}"`)
            .join(',')}}`
        : '';
      return `${name}${tags} ${Number.isFinite(sample) ? sample : 0}`;
    }),
  ].join('\n');

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', { compress: false }, async (request, reply) => {
    const token = config.metricsToken || settings.get('metrics.token');
    if (!token) throw notFound();
    const header = String(request.headers.authorization ?? '');
    if (!header.startsWith('Bearer ') || !safeEqual(header.slice(7), token)) throw unauthorized('Für die Metriken fehlt das Token');
    const count = (sql: string) => value<number>(sql) ?? 0;
    const scan = scanStats();
    const memory = process.memoryUsage();
    const database = databaseInfo();
    const body = [
      line('moecloud_info', 'Version von MoeCloud', 'gauge', [[{ version: config.version, node: process.version }, 1]]),
      line('moecloud_uptime_seconds', 'Laufzeit des Prozesses', 'gauge', [[null, Math.round(process.uptime())]]),
      line('moecloud_database_bytes', 'Größe der Datenbank', 'gauge', [
        [{ kind: database.dialect, version: database.version }, database.size],
      ]),
      line('moecloud_users', 'Konten', 'gauge', [
        [{ state: 'active' }, count('SELECT COUNT(*) FROM users WHERE disabled = 0')],
        [{ state: 'disabled' }, count('SELECT COUNT(*) FROM users WHERE disabled = 1')],
      ]),
      line('moecloud_files', 'Dateien', 'gauge', [
        [{ state: 'active' }, count("SELECT COUNT(*) FROM nodes WHERE type = 'file' AND trashed_at IS NULL")],
        [{ state: 'trashed' }, count("SELECT COUNT(*) FROM nodes WHERE type = 'file' AND trashed_at IS NOT NULL")],
      ]),
      line('moecloud_folders', 'Ordner', 'gauge', [
        [null, count("SELECT COUNT(*) FROM nodes WHERE type = 'folder' AND parent_id IS NOT NULL")],
      ]),
      line('moecloud_bytes', 'Belegter Speicher', 'gauge', [
        [{ kind: 'logical' }, count("SELECT COALESCE(SUM(size), 0) FROM nodes WHERE type = 'file'")],
        [{ kind: 'physical' }, count('SELECT COALESCE(SUM(size), 0) FROM blobs')],
        [{ kind: 'versions' }, count('SELECT COALESCE(SUM(size), 0) FROM versions')],
      ]),
      line('moecloud_links', 'Öffentliche Links', 'gauge', [[null, count('SELECT COUNT(*) FROM links')]]),
      line('moecloud_shares', 'Freigaben für Personen', 'gauge', [[null, count('SELECT COUNT(*) FROM grants')]]),
      line('moecloud_uploads_open', 'Laufende Uploads in Teilen', 'gauge', [[null, count('SELECT COUNT(*) FROM uploads')]]),
      line('moecloud_sessions', 'Angemeldete Sitzungen', 'gauge', [[null, count('SELECT COUNT(*) FROM sessions')]]),
      line('moecloud_live_connections', 'Offene Live-Verbindungen', 'gauge', [[null, liveCount()]]),
      line('moecloud_processing_pending', 'Dateien, die noch verarbeitet werden', 'gauge', [[null, pendingCount()]]),
      line(
        'moecloud_scan_files',
        'Dateien nach Ergebnis des Virenscans',
        'gauge',
        (['clean', 'infected', 'skipped', 'error', 'released', 'unscanned'] as const).map((status) => [{ status }, scan[status]])
      ),
      line('moecloud_login_failures_24h', 'Fehlgeschlagene Anmeldungen in 24 Stunden', 'gauge', [
        [null, value<number>("SELECT COUNT(*) FROM audit WHERE action = 'login_failed' AND created_at > ?", Date.now() - 86_400_000) ?? 0],
      ]),
      line('process_resident_memory_bytes', 'Arbeitsspeicher des Prozesses', 'gauge', [[null, memory.rss]]),
      line('nodejs_heap_used_bytes', 'Belegter Heap', 'gauge', [[null, memory.heapUsed]]),
    ].join('\n');
    return reply.type('text/plain; version=0.0.4; charset=utf-8').header('Cache-Control', 'no-store').send(`${body}\n`);
  });
}
