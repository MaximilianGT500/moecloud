import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync, type SQLInputValue } from 'node:sqlite';
import { migrate, pendingMigrations } from './schema.ts';

export type Param = SQLInputValue | boolean | undefined;

let database: DatabaseSync | null = null;
const statements = new Map<string, StatementSync>();
let depth = 0;
export let updateBackup: string | null = null;

export const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export function vacuumInto(target: string) {
  db().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

export function openDatabase(file: string, backupDir?: string) {
  closeDatabase();
  database = new DatabaseSync(file);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA temp_store = MEMORY');
  const version = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  updateBackup = null;
  if (backupDir && version > 0 && pendingMigrations(database) > 0) {
    mkdirSync(backupDir, { recursive: true });
    updateBackup = vacuumInto(join(backupDir, `moecloud-update-v${version}-${stamp()}.db`));
  }
  migrate(database);
  return database;
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
