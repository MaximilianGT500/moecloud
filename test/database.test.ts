import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { createApp, setUp, type Client } from './helpers.ts';
import { config } from '../src/config.ts';
import { copyDatabase, copyDatabaseSync } from '../src/lib/copy.ts';
import * as store from '../src/lib/db.ts';
import { schemaVersion } from '../src/lib/schema.ts';
import { TABLES } from '../src/lib/schema-pg.ts';
import { toPostgres } from '../src/lib/sql.ts';
import { findByUsername } from '../src/services/users.ts';

const server = process.env.TEST_POSTGRES;
const dir = join(config.dataDir, 'kopien');
mkdirSync(dir, { recursive: true });

async function freshPostgres(name: string) {
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const url = new URL(server!);
  url.pathname = `/${name}`;
  return url.toString();
}

function sqliteTables(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const names = (
      db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '%fts%' AND name NOT LIKE 'sqlite_%'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    return Object.fromEntries(
      names.map((name) => [
        name,
        (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((column) => column.name).sort(),
      ])
    );
  } finally {
    db.close();
  }
}

function contents(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return Object.fromEntries(
      TABLES.map((table) => {
        const rows = db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
        const normal = rows.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));
        return [table, normal.sort()];
      })
    );
  } finally {
    db.close();
  }
}

describe('SQL für PostgreSQL', () => {
  it('übersetzt Platzhalter und die SQLite-Eigenheiten', () => {
    assert.deepEqual(
      toPostgres("SELECT * FROM users WHERE name LIKE ? ESCAPE '\\' AND note = 'Emi?' ORDER BY name COLLATE NOCASE LIMIT ?"),
      {
        text: "SELECT * FROM users WHERE name ILIKE $1 ESCAPE '\\' AND note = 'Emi?' ORDER BY lower(name) LIMIT $2",
        identity: null,
      }
    );
    assert.equal(
      toPostgres('SELECT 1 FROM activity WHERE parent_id IS ? AND actor_id IS NOT ?').text.includes(
        'IS NOT DISTINCT FROM $1 AND actor_id IS DISTINCT FROM $2'
      ),
      true
    );
    assert.deepEqual(toPostgres('INSERT OR IGNORE INTO stars (user_id, node_id, created_at) VALUES (?, ?, ?)'), {
      text: 'INSERT INTO stars (user_id, node_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      identity: null,
    });
    assert.deepEqual(toPostgres('INSERT INTO groups (name, name_key, created_at) VALUES (?, ?, ?)'), {
      text: 'INSERT INTO groups (name, name_key, created_at) VALUES ($1, $2, $3) RETURNING id',
      identity: 'id',
    });
    assert.equal(
      toPostgres('SELECT CAST(? AS TEXT) COLLATE BINARY -- Lea?\n, ?').text,
      'SELECT CAST($1 AS TEXT) COLLATE "C" -- Lea?\n, $2'
    );
  });
});

describe('Kopieren zwischen Datenbanken', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let emi: Client;
  let source = '';

  before(async () => {
    app = await createApp();
    emi = await setUp(app);
    const root = findByUsername('emi')!.root_id!;
    const folder = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Reise mit Mia' })).json().node;
    for (const [name, text] of [
      ['Packliste.md', '# Packliste\n\nRegenjacke für Lea'],
      ['Notizen.txt', 'Tempel in Kyoto am Morgen'],
    ]) {
      assert.equal((await emi.upload(folder.id, name, Buffer.from(text), 1024)).statusCode, 200);
    }
    const replaced = await emi.upload(folder.id, 'Packliste.md', Buffer.from('# Packliste\n\nRegenjacke und Schirm für Lea'), 1024, {
      conflict: 'replace',
    });
    assert.equal(replaced.statusCode, 200);
    source = join(dir, 'quelle.db');
    store.snapshotDatabase(source);
  });

  after(() => app.close());

  it('kopiert eine SQLite-Datenbank vollständig in eine neue Datei', async () => {
    const target = join(dir, 'ziel.db');
    const seen: string[] = [];
    const result = await copyDatabase(source, target, (table) => seen.push(table));
    assert.ok(result.rows > 10);
    assert.ok(seen.includes('nodes'));
    assert.deepEqual(contents(target), contents(source));
    await assert.rejects(copyDatabase(source, target), /gibt es schon/);
    assert.throws(() => copyDatabaseSync(join(dir, 'fehlt.db'), join(dir, 'egal.db')), /gibt es nicht/);
  });

  it('kennt jede Tabelle', () => {
    assert.deepEqual(Object.keys(sqliteTables(source)).sort(), [...TABLES].sort());
  });

  it('bringt Daten über PostgreSQL unverändert zurück', { skip: !server && 'TEST_POSTGRES ist nicht gesetzt' }, async () => {
    const url = await freshPostgres('moecloud_test_kopie');
    const there = await copyDatabase(source, url);
    assert.equal(there.tables.nodes, contents(source).nodes.length);
    await assert.rejects(copyDatabase(source, url), /nicht leer/);
    const back = join(dir, 'zurueck.db');
    copyDatabaseSync(url, back);
    assert.deepEqual(contents(back), contents(source));
    const check = new pg.Client({ connectionString: url });
    await check.connect();
    try {
      const { rows } = await check.query(
        "SELECT refs FROM blobs JOIN nodes ON nodes.sha256 = blobs.sha256 WHERE nodes.name = 'Notizen.txt'"
      );
      assert.equal(Number(rows[0].refs), 1);
      const next = await check.query("INSERT INTO groups (name, name_key, created_at) VALUES ('Familie', 'familie', 1) RETURNING id");
      const highest = await check.query('SELECT MAX(id) AS id FROM groups');
      assert.equal(Number(next.rows[0].id), Number(highest.rows[0].id));
    } finally {
      await check.end();
    }
  });

  it('nimmt eine PostgreSQL-Datenbank, die MoeCloud nur angelegt hat', { skip: !server && 'TEST_POSTGRES ist nicht gesetzt' }, async () => {
    const url = await freshPostgres('moecloud_test_leer');
    const empty = join(dir, 'leer.db');
    store.openDatabase(empty);
    store.closeDatabase();
    store.openDatabase(config.database);
    await copyDatabase(empty, url);
    const running = new pg.Client({ connectionString: url, application_name: 'moecloud' });
    await running.connect();
    try {
      await assert.rejects(copyDatabase(source, url), /noch mit der Ziel-Datenbank verbunden/);
    } finally {
      await running.end();
    }
    const result = await copyDatabase(source, url);
    assert.equal(result.tables.users, contents(source).users.length);
    await assert.rejects(copyDatabase(empty, url), /nicht leer/);
  });

  it('hat in SQLite und PostgreSQL dieselben Spalten', { skip: !server && 'TEST_POSTGRES ist nicht gesetzt' }, async () => {
    const url = await freshPostgres('moecloud_test_schema');
    const fresh = join(dir, 'frisch.db');
    store.openDatabase(fresh);
    store.closeDatabase();
    await copyDatabase(fresh, url);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    let rows: { table_name: string; column_name: string }[] = [];
    let version = 0;
    try {
      rows = (
        await client.query(
          "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND is_generated = 'NEVER' AND table_name <> 'moecloud_schema'"
        )
      ).rows;
      version = Number((await client.query('SELECT version FROM moecloud_schema')).rows[0].version);
    } finally {
      await client.end();
    }
    const postgres: Record<string, string[]> = {};
    for (const row of rows) (postgres[row.table_name] ??= []).push(row.column_name);
    for (const columns of Object.values(postgres)) columns.sort();
    assert.deepEqual(postgres, sqliteTables(fresh));
    assert.equal(version, schemaVersion());
    store.openDatabase(config.database);
  });
});
