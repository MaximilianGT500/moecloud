import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'moecloud-test-'));
process.env.TEST_FEED_PORT = String(40_000 + Math.floor(Math.random() * 20_000));
process.env.UPDATE_CHECK_URL = `http://127.0.0.1:${process.env.TEST_FEED_PORT}/version.json`;
process.env.METRICS_TOKEN = '';
process.env.MOEPULSE_DISABLED = '1';

const server = process.env.TEST_POSTGRES;
if (server && isMainThread) {
  const { default: pg } = await import('pg');
  const name = `moecloud_test_${process.pid}_${Date.now().toString(36)}`;
  const client = new pg.Client({ connectionString: server });
  await client.connect();
  const stale = await client.query("SELECT datname FROM pg_database WHERE datname LIKE 'moecloud_test_%'");
  for (const row of stale.rows) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await client.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  await client.query(`CREATE DATABASE "${name}"`);
  await client.end();
  const url = new URL(server);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
}
