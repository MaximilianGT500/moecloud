import { closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { migrate, pendingMigrations } from './schema.ts';

export type Param = SQLInputValue | boolean | undefined;

let database: DatabaseSync | null = null;
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

export function openDatabase(file: string, backupDir?: string) {
  closeDatabase();
  const handle = new DatabaseSync(file);
  database = handle;
  location = file;
  updateBackup = null;
  try {
    handle.exec('PRAGMA busy_timeout = 5000');
    handle.exec('PRAGMA journal_mode = WAL');
    handle.exec('PRAGMA synchronous = NORMAL');
    handle.exec('PRAGMA foreign_keys = ON');
    handle.exec('PRAGMA temp_store = MEMORY');
    const version = (handle.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (backupDir && version > 0 && pendingMigrations(handle) > 0) updateBackup = updateBackupIn(backupDir, version);
    migrate(handle);
  } catch (error) {
    closeDatabase();
    throw error;
  }
  return handle;
}

export function closeDatabase() {
  statements.clear();
  if (database?.isOpen) {
    try {
      database.exec('PRAGMA optimize');
    } catch {}
    database.close();
  }
  database = null;
  location = null;
}

export function db(): DatabaseSync {
  if (!database) throw new Error('Datenbank ist nicht geöffnet');
  return database;
}

function statement(sql: string) {
  let prepared = statements.get(sql);
  if (!prepared) {
    prepared = db().prepare(sql);
    statements.set(sql, prepared);
  }
  return prepared;
}

const bind = (params: Param[]): SQLInputValue[] =>
  params.map((value) => (value === undefined ? null : typeof value === 'boolean' ? (value ? 1 : 0) : value));

export function one<T>(sql: string, ...params: Param[]): T | undefined {
  return statement(sql).get(...bind(params)) as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return statement(sql).all(...bind(params)) as T[];
}

export function run(sql: string, ...params: Param[]) {
  const result = statement(sql).run(...bind(params));
  return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
}

export function value<T>(sql: string, ...params: Param[]): T | undefined {
  const row = one<Record<string, T>>(sql, ...params);
  return row ? Object.values(row)[0] : undefined;
}

export function tx<T>(fn: () => T): T {
  const point = `sp${depth}`;
  db().exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${point}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db().exec(depth === 0 ? 'COMMIT' : `RELEASE ${point}`);
    return result;
  } catch (error) {
    depth--;
    db().exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${point}; RELEASE ${point}`);
    throw error;
  }
}

export const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');
