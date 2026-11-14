import { closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { copyDatabase, copyDatabaseSync } from './copy.ts';
import { isPostgresUrl, Postgres } from './postgres.ts';
import { migrate, pendingMigrations, schemaVersion } from './schema.ts';
import { PG_BASE, PG_BASE_VERSION, PG_STEPS } from './schema-pg.ts';
import { toPostgres } from './sql.ts';

export type Param = SQLInputValue | boolean | undefined;

export type Dialect = 'sqlite' | 'postgres';

let database: DatabaseSync | null = null;
let postgres: Postgres | null = null;
let location: string | null = null;
const statements = new Map<string, StatementSync>();
let depth = 0;
export let updateBackup: string | null = null;

const HEADER = 'SQLite format 3\u0000';

export const isLockError = (error: unknown) => [5, 6, 15].includes(((error as { errcode?: number } | null)?.errcode ?? 0) & 0xff);

export const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

const uri = (file: string, flag: string) => `${pathToFileURL(file).href}?${flag}=1`;

function discard(file: string) {
  try {
    if (statSync(file, { throwIfNoEntry: false })?.isFile()) rmSync(file, { force: true });
  } catch {}
}

function verify(file: string) {
  const header = Buffer.alloc(HEADER.length);
  const handle = openSync(file, 'r');
  try {
    readSync(handle, header, 0, header.length, 0);
  } finally {
    closeSync(handle);
  }
  if (header.toString('latin1') !== HEADER) throw new Error('Die Sicherung ist unvollständig');
  const copy = new DatabaseSync(uri(file, 'immutable'), { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
    if (check.length !== 1 || check[0].quick_check !== 'ok') throw new Error('Die Sicherung ist beschädigt');
  } finally {
    copy.close();
  }
}

function copyInto(target: string) {
  if (!location || location === ':memory:') throw new Error('Die Datenbank liegt nicht in einer Datei');
  const handle = db();
  const checkpoint = handle.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number; log: number } | undefined;
  if (checkpoint && (checkpoint.busy !== 0 || checkpoint.log > 0)) throw new Error('Ein anderer Prozess benutzt die Datenbank gerade');
  const partial = `${target}.partial`;
  try {
    handle.exec('BEGIN');
    try {
      handle.prepare('SELECT count(*) FROM sqlite_schema').get();
      if ((statSync(`${location}-wal`, { throwIfNoEntry: false })?.size ?? 0) > 0)
        throw new Error('Die Datenbank hat sich während der Sicherung geändert');
      copyFileSync(location, partial, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    } finally {
      handle.exec('COMMIT');
    }
    verify(partial);
    renameSync(partial, target);
  } catch (error) {
    discard(partial);
    throw error;
  }
}

export function snapshotDatabase(target: string) {
  if (existsSync(target)) throw new Error(`${target} gibt es schon`);
  if (postgres) {
    copyDatabaseSync(location!, target);
    return target;
  }
  try {
    db().prepare('VACUUM INTO ?').run(uri(target, 'nolock'));
    verify(target);
    return target;
  } catch (error) {
    discard(target);
    discard(`${target}-journal`);
    try {
      copyInto(target);
      return target;
    } catch (fallback) {
      throw new Error(`${(error as Error).message}, auch die Kopie ging nicht: ${(fallback as Error).message}`, { cause: error });
    }
  }
}

export async function snapshotDatabaseAsync(target: string) {
  if (!postgres) return snapshotDatabase(target);
  if (existsSync(target)) throw new Error(`${target} gibt es schon`);
  await copyDatabase(location!, target);
  return target;
}

function updateBackupIn(backupDir: string, version: number) {
  try {
    mkdirSync(backupDir, { recursive: true });
    return snapshotDatabase(join(backupDir, `moecloud-update-v${version}-${stamp()}.db`));
  } catch (error) {
    throw new Error(
      `Vor dem Update der Datenbank konnte MoeCloud keine Sicherung in ${backupDir} anlegen, darum bleibt die Datenbank unverändert. ` +
        `Prüfe, ob der Ordner beschreibbar ist und ob MoeCloud nur einmal mit diesem Datenordner läuft. Ursache: ${(error as Error).message}`,
      { cause: error }
    );
  }
}

function postgresVersion(handle: Postgres) {
  handle.exec('CREATE TABLE IF NOT EXISTS moecloud_schema (version BIGINT NOT NULL)');
  return Number(handle.query('SELECT version FROM moecloud_schema').rows[0]?.version ?? 0);
}

function postgresMigrate(handle: Postgres) {
  let version = postgresVersion(handle);
  if (version > schemaVersion()) throw new Error(`Die Datenbank stammt von einer neueren MoeCloud mit Stand ${version}`);
  while (version < schemaVersion()) {
    const next = version === 0 ? PG_BASE_VERSION : version + 1;
    const step = version === 0 ? PG_BASE : PG_STEPS[next];
    if (!step) throw new Error(`Für PostgreSQL fehlt der Schritt zu Stand ${next}`);
    handle.exec('BEGIN');
    try {
      handle.exec(step);
      handle.exec('DELETE FROM moecloud_schema');
      handle.query('INSERT INTO moecloud_schema (version) VALUES ($1)', [next]);
      handle.exec('COMMIT');
    } catch (error) {
      handle.exec('ROLLBACK');
      throw error;
    }
    version = next;
  }
}

function openPostgres(url: string, backupDir?: string) {
  const handle = new Postgres(url);
  postgres = handle;
  location = url;
  try {
    const version = postgresVersion(handle);
    if (backupDir && version > 0 && version < schemaVersion()) updateBackup = updateBackupIn(backupDir, version);
    postgresMigrate(handle);
  } catch (error) {
    closeDatabase();
    throw error;
  }
}

export function openDatabase(target: string, backupDir?: string) {
  closeDatabase();
  updateBackup = null;
  if (isPostgresUrl(target)) return openPostgres(target, backupDir);
  const handle = new DatabaseSync(target);
  database = handle;
  location = target;
  try {
    handle.exec('PRAGMA busy_timeout = 5000');
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = NORMAL');
    handle.exec('PRAGMA foreign_keys = ON');
    handle.exec('PRAGMA temp_store = MEMORY');
    handle.exec('PRAGMA cache_size = -32768');
    const version = (handle.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (backupDir && version > 0 && pendingMigrations(handle) > 0) updateBackup = updateBackupIn(backupDir, version);
    migrate(handle);
  } catch (error) {
    closeDatabase();
    throw error;
  }
}

export function closeDatabase() {
  statements.clear();
  depth = 0;
  if (database?.isOpen) {
    try {
      database.exec('PRAGMA optimize');
    } catch {}
    database.close();
  }
  if (postgres) {
    try {
      postgres.close();
    } catch {}
  }
  database = null;
  postgres = null;
  location = null;
}

export const dialect = (): Dialect => (postgres ? 'postgres' : 'sqlite');

export const IN_LIST = 'IN (SELECT value FROM json_each(?))';

export function databaseInfo() {
  if (postgres) {
    const size = Number(postgres.query('SELECT pg_database_size(current_database()) AS size').rows[0]?.size ?? 0);
    return { dialect: 'postgres' as Dialect, version: `PostgreSQL ${postgres.version.split(' ')[0]}`, size };
  }
  const version = (db().prepare('SELECT sqlite_version() AS version').get() as { version: string }).version;
  const file = location && location !== ':memory:' ? location : null;
  const size = file
    ? (statSync(file, { throwIfNoEntry: false })?.size ?? 0) + (statSync(`${file}-wal`, { throwIfNoEntry: false })?.size ?? 0)
    : 0;
  return { dialect: 'sqlite' as Dialect, version: `SQLite ${version}`, size };
}

export function maintainDatabase() {
  if (postgres) return;
  try {
    db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db().exec('PRAGMA optimize');
  } catch {}
}

export const databaseLocation = () => location;

export function db(): DatabaseSync {
  if (!database) throw new Error(postgres ? 'Diese Funktion gibt es nur mit SQLite' : 'Datenbank ist nicht geöffnet');
  return database;
}

function statement(sql: string) {
  let prepared = statements.get(sql);
  if (!prepared) {
    prepared = db().prepare(sql);
    if (statements.size >= 1000) statements.clear();
    statements.set(sql, prepared);
  }
  return prepared;
}

const bind = (params: Param[]): SQLInputValue[] =>
  params.map((value) => (value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value));

function pg() {
  if (!postgres) throw new Error('Datenbank ist nicht geöffnet');
  return postgres;
}

export function one<T>(sql: string, ...params: Param[]): T | undefined {
  if (postgres) return pg().query(toPostgres(sql).text, bind(params)).rows[0] as T | undefined;
  return statement(sql).get(...bind(params)) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  if (postgres) return pg().query(toPostgres(sql).text, bind(params)).rows as T[];
  return statement(sql).all(...bind(params)) as T[];
}

export function run(sql: string, ...params: Param[]) {
  if (postgres) {
    const translated = toPostgres(sql);
    const result = pg().query(translated.text, bind(params));
    return { changes: result.rowCount, lastId: translated.identity ? Number(result.rows[0]?.[translated.identity] ?? 0) : 0 };
  }
  const result = statement(sql).run(...bind(params));
  return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
}

export function value<T>(sql: string, ...params: Param[]): T | undefined {
  const row = one<Record<string, T>>(sql, ...params);
  return row ? Object.values(row)[0] : undefined;
}

function execute(sql: string) {
  if (postgres) pg().exec(sql);
  else db().exec(sql);
}

export function tx<T>(fn: () => T): T {
  const point = `sp${depth}`;
  execute(depth === 0 ? (postgres ? 'BEGIN' : 'BEGIN IMMEDIATE') : `SAVEPOINT ${point}`);
  depth++;
  try {
    const result = fn();
    depth--;
    execute(depth === 0 ? 'COMMIT' : `RELEASE ${point}`);
    return result;
  } catch (error) {
    depth--;
    execute(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${point}; RELEASE ${point}`);
    throw error;
  }
}

export const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
