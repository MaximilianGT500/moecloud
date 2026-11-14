import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import pg from 'pg';
import { isPostgresUrl } from './postgres.ts';
import { migrate, schemaVersion } from './schema.ts';
import { PG_BASE, PG_BASE_VERSION, PG_IDENTITY, PG_STEPS, RECOUNT_REFS, TABLES } from './schema-pg.ts';

type Row = unknown[];

interface Reader {
  columns(table: string): Promise<string[]>;
  rows(table: string, columns: string[], size: number): AsyncGenerator<Row[]>;
  close(): Promise<void>;
}

interface Writer {
  columns(table: string): Promise<string[]>;
  insert(table: string, columns: string[], rows: Row[]): Promise<void>;
  finish(): Promise<void>;
  abort(): Promise<void>;
}

const { from, to, port, signal } = workerData as { from: string; to: string; port?: MessagePort; signal?: Int32Array };

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const list = (columns: string[]) => columns.map(quote).join(', ');

async function postgres(url: string) {
  const client = new pg.Client({ connectionString: url, application_name: 'moecloud-copy' });
  await client.connect();
  await client.query("SET client_min_messages = 'warning'");
  return client;
}

async function unused(client: pg.Client, existing: Set<string>) {
  for (const table of ['users', 'nodes']) {
    if (!existing.has(table)) continue;
    const { rows } = await client.query(`SELECT EXISTS (SELECT 1 FROM ${quote(table)}) AS used`);
    if (rows[0]?.used) return false;
  }
  return true;
}

async function connected(client: pg.Client) {
  const { rows } = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND application_name = 'moecloud' AND pid <> pg_backend_pid()) AS busy"
  );
  return Boolean(rows[0]?.busy);
}

async function postgresColumns(client: pg.Client, table: string) {
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((row) => row.column_name as string);
}

async function postgresVersion(client: pg.Client) {
  const { rows } = await client.query("SELECT to_regclass('moecloud_schema') IS NOT NULL AS present");
  if (!rows[0].present) return 0;
  const found = await client.query('SELECT version FROM moecloud_schema');
  return Number(found.rows[0]?.version ?? 0);
}

async function postgresReader(url: string): Promise<Reader> {
  const client = await postgres(url);
  const version = await postgresVersion(client);
  if (version === 0) throw new Error('In dieser PostgreSQL-Datenbank liegt noch keine MoeCloud');
  if (version !== schemaVersion()) {
    throw new Error(
      `Die Quelle hat Stand ${version}, diese MoeCloud Stand ${schemaVersion()}. Starte MoeCloud einmal mit der Quelle, dann passt es`
    );
  }
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  return {
    columns: (table) => postgresColumns(client, table),
    async *rows(table, columns, size) {
      await client.query(`DECLARE moecloud_copy NO SCROLL CURSOR FOR SELECT ${list(columns)} FROM ${quote(table)}`);
      for (;;) {
        const { rows } = await client.query({ text: `FETCH ${size} FROM moecloud_copy`, rowMode: 'array' });
        if (!rows.length) break;
        yield rows as Row[];
      }
      await client.query('CLOSE moecloud_copy');
    },
    async close() {
      await client.query('COMMIT').catch(() => undefined);
      await client.end();
    },
  };
}

function sqliteReader(file: string): Reader {
  if (!existsSync(file)) throw new Error(`${file} gibt es nicht`);
  let path = file;
  let temp: string | null = null;
  const probe = new DatabaseSync(file, { readOnly: true });
  const version = (probe.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  probe.close();
  if (version === 0) throw new Error(`In ${file} liegt keine MoeCloud-Datenbank`);
  if (version > schemaVersion()) throw new Error(`${file} stammt von einer neueren MoeCloud mit Stand ${version}`);
  if (version < schemaVersion()) {
    temp = mkdtempSync(join(tmpdir(), 'moecloud-copy-'));
    path = join(temp, 'quelle.db');
    copyFileSync(file, path);
    if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${path}-wal`);
    const upgrade = new DatabaseSync(path);
    migrate(upgrade);
    upgrade.close();
  }
  const db = new DatabaseSync(path);
  db.exec('BEGIN');
  return {
    columns: async (table) => (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((column) => column.name),
    async *rows(table, columns, size) {
      let batch: Row[] = [];
      for (const row of db.prepare(`SELECT ${list(columns)} FROM ${quote(table)}`).iterate() as Iterable<Record<string, unknown>>) {
        batch.push(columns.map((column) => row[column]));
        if (batch.length >= size) {
          yield batch;
          batch = [];
        }
      }
      if (batch.length) yield batch;
    },
    async close() {
      db.exec('COMMIT');
      db.close();
      if (temp) rmSync(temp, { recursive: true, force: true });
    },
  };
}

async function postgresWriter(url: string): Promise<Writer> {
  const client = await postgres(url);
  const { rows } = await client.query(
    'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1)',
    [[...TABLES, 'moecloud_schema']]
  );
  const existing = new Set(rows.map((row: { table_name: string }) => row.table_name));
  if (existing.size && !(await unused(client, existing))) {
    await client.end();
    throw new Error('Die Ziel-Datenbank ist nicht leer. Leg eine neue, leere Datenbank an');
  }
  if (existing.size && (await connected(client))) {
    await client.end();
    throw new Error('MoeCloud ist noch mit der Ziel-Datenbank verbunden. Halte MoeCloud an und starte den Befehl dann noch einmal');
  }
  await client.query('BEGIN');
  if (existing.size) {
    await client.query(`DROP TABLE IF EXISTS ${list([...TABLES, 'moecloud_schema'])} CASCADE`);
    await client.query(
      'DROP FUNCTION IF EXISTS moecloud_ref_add(), moecloud_ref_remove(), moecloud_ref_move(), moecloud_media_at(), moecloud_media_taken() CASCADE'
    );
  }
  await client.query('CREATE TABLE moecloud_schema (version BIGINT NOT NULL)');
  await client.query(PG_BASE);
  for (let version = PG_BASE_VERSION + 1; version <= schemaVersion(); version++) await client.query(PG_STEPS[version]);
  await client.query('INSERT INTO moecloud_schema (version) VALUES ($1)', [schemaVersion()]);
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  return {
    columns: (table) => postgresColumns(client, table),
    async insert(table, columns, rows) {
      const per = Math.max(1, Math.floor(30_000 / columns.length));
      for (let start = 0; start < rows.length; start += per) {
        const chunk = rows.slice(start, start + per);
        const values: unknown[] = [];
        const tuples = chunk.map((row) => {
          const slots = row.map((value) => {
            values.push(value instanceof Uint8Array && !Buffer.isBuffer(value) ? Buffer.from(value) : value);
            return `$${values.length}`;
          });
          return `(${slots.join(', ')})`;
        });
        await client.query(`INSERT INTO ${quote(table)} (${list(columns)}) VALUES ${tuples.join(', ')}`, values);
      }
    },
    async finish() {
      await client.query(RECOUNT_REFS);
      for (const [table, column] of Object.entries(PG_IDENTITY)) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('${table}', '${column}'), COALESCE((SELECT MAX(${quote(column)}) FROM ${quote(table)}), 0) + 1, false)`
        );
      }
      await client.query('COMMIT');
      await client.query(`ANALYZE ${list(TABLES)}`);
      await client.end();
    },
    async abort() {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}

function sqliteWriter(file: string): Writer {
  if (existsSync(file)) throw new Error(`${file} gibt es schon`);
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  const db = new DatabaseSync(partial);
  const statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  db.exec('PRAGMA journal_mode = MEMORY');
  db.exec('PRAGMA synchronous = OFF');
  migrate(db);
  db.exec('BEGIN');
  db.exec('PRAGMA defer_foreign_keys = ON');
  return {
    columns: async (table) => (db.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((column) => column.name),
    async insert(table, columns, rows) {
      const key = `${table}:${columns.join(',')}`;
      let statement = statements.get(key);
      if (!statement) {
        statement = db.prepare(`INSERT INTO ${quote(table)} (${list(columns)}) VALUES (${columns.map(() => '?').join(', ')})`);
        statements.set(key, statement);
      }
      for (const row of rows) statement.run(...(row as SQLInputValue[]));
    },
    async finish() {
      db.exec(RECOUNT_REFS);
      db.exec('COMMIT');
      const check = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
      db.close();
      if (check.length !== 1 || check[0].quick_check !== 'ok') {
        rmSync(partial, { force: true });
        throw new Error('Die Kopie ist beschädigt');
      }
      renameSync(partial, file);
    },
    async abort() {
      try {
        db.exec('ROLLBACK');
      } catch {}
      try {
        db.close();
      } catch {}
      rmSync(partial, { force: true });
    },
  };
}

function send(message: Record<string, unknown>) {
  if (port) port.postMessage(message);
  else parentPort?.postMessage(message);
}

async function copy() {
  const started = Date.now();
  const reader = isPostgresUrl(from) ? await postgresReader(from) : sqliteReader(from);
  let writer: Writer;
  try {
    writer = isPostgresUrl(to) ? await postgresWriter(to) : sqliteWriter(to);
  } catch (error) {
    await reader.close();
    throw error;
  }
  const tables: Record<string, number> = {};
  try {
    for (const table of TABLES) {
      const target = await writer.columns(table);
      const source = new Set(await reader.columns(table));
      const columns = target.filter((column) => source.has(column));
      const size = table === 'blob_text' ? 50 : 1000;
      let count = 0;
      for await (const rows of reader.rows(table, columns, size)) {
        await writer.insert(table, columns, rows);
        count += rows.length;
        send({ kind: 'progress', table, rows: count });
      }
      tables[table] = count;
    }
    await writer.finish();
  } catch (error) {
    await writer.abort();
    throw error;
  } finally {
    await reader.close();
  }
  return { tables, rows: Object.values(tables).reduce((sum, count) => sum + count, 0), seconds: (Date.now() - started) / 1000 };
}

let beat: NodeJS.Timeout | undefined;
if (signal) {
  beat = setInterval(() => Atomics.add(signal, 1, 1), 1000);
}

copy()
  .then((result) => send({ kind: 'done', result }))
  .catch((error: Error) => send({ kind: 'error', message: error.message }))
  .finally(() => {
    if (beat) clearInterval(beat);
    if (signal) {
      Atomics.store(signal, 0, 1);
      Atomics.notify(signal, 0);
    }
  });
