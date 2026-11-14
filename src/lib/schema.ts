import type { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    email TEXT,
    email_key TEXT UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    disabled INTEGER NOT NULL DEFAULT 0,
    quota_bytes INTEGER,
    language TEXT,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last INTEGER NOT NULL DEFAULT 0,
    oidc_sub TEXT UNIQUE,
    root_id TEXT,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX recovery_codes_user ON recovery_codes(user_id);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    csrf TEXT NOT NULL,
    method TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    device_type TEXT,
    backed_up INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX passkeys_user ON passkeys(user_id);

  CREATE TABLE app_passwords (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    hint TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX app_passwords_user ON app_passwords(user_id);

  CREATE TABLE invites (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note TEXT,
    quota_bytes INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    used_by INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE blobs (
    sha256 TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    refs INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    thumb INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX blobs_refs ON blobs(refs);

  CREATE TABLE nodes (
    seq INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mime TEXT,
    sha256 TEXT REFERENCES blobs(sha256),
    created_by INTEGER,
    updated_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    trashed_at INTEGER,
    trash_root INTEGER NOT NULL DEFAULT 0,
    etag INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX nodes_name ON nodes(parent_id, name_key) WHERE trashed_at IS NULL;
  CREATE INDEX nodes_parent ON nodes(parent_id, type);
  CREATE INDEX nodes_owner_updated ON nodes(owner_id, type, updated_at);
  CREATE INDEX nodes_trash ON nodes(owner_id, trash_root, trashed_at);
  CREATE INDEX nodes_sha ON nodes(sha256);

  CREATE VIRTUAL TABLE nodes_fts USING fts5(name, content='nodes', content_rowid='seq', tokenize='trigram');

  CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, name) VALUES (new.seq, new.name);
  END;
  CREATE TRIGGER nodes_fts_delete AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, name) VALUES ('delete', old.seq, old.name);
  END;
  CREATE TRIGGER nodes_fts_update AFTER UPDATE OF name ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, name) VALUES ('delete', old.seq, old.name);
    INSERT INTO nodes_fts(rowid, name) VALUES (new.seq, new.name);
  END;

  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL REFERENCES blobs(sha256),
    size INTEGER NOT NULL,
    mime TEXT,
    author_id INTEGER,
    modified_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX versions_node ON versions(node_id, created_at);

  CREATE TRIGGER blob_ref_node_insert AFTER INSERT ON nodes WHEN new.sha256 IS NOT NULL BEGIN
    UPDATE blobs SET refs = refs + 1 WHERE sha256 = new.sha256;
  END;
  CREATE TRIGGER blob_ref_node_delete AFTER DELETE ON nodes WHEN old.sha256 IS NOT NULL BEGIN
    UPDATE blobs SET refs = refs - 1 WHERE sha256 = old.sha256;
  END;
  CREATE TRIGGER blob_ref_node_update AFTER UPDATE OF sha256 ON nodes WHEN old.sha256 IS NOT new.sha256 BEGIN
    UPDATE blobs SET refs = refs - 1 WHERE sha256 = old.sha256;
    UPDATE blobs SET refs = refs + 1 WHERE sha256 = new.sha256;
  END;
  CREATE TRIGGER blob_ref_version_insert AFTER INSERT ON versions BEGIN
    UPDATE blobs SET refs = refs + 1 WHERE sha256 = new.sha256;
  END;
  CREATE TRIGGER blob_ref_version_delete AFTER DELETE ON versions BEGIN
    UPDATE blobs SET refs = refs - 1 WHERE sha256 = old.sha256;
  END;

  CREATE TABLE stars (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, node_id)
  );
  CREATE INDEX stars_node ON stars(node_id);

  CREATE TABLE links (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT,
    password_hash TEXT,
    expires_at INTEGER,
    allow_download INTEGER NOT NULL DEFAULT 1,
    allow_upload INTEGER NOT NULL DEFAULT 0,
    upload_only INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_access_at INTEGER
  );
  CREATE INDEX links_node ON links(node_id);
  CREATE INDEX links_creator ON links(created_by);

  CREATE TABLE grants (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (node_id, user_id)
  );
  CREATE INDEX grants_user ON grants(user_id);

  CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    link_id TEXT REFERENCES links(id) ON DELETE CASCADE,
    parent_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    relative_path TEXT,
    size INTEGER NOT NULL,
    received INTEGER NOT NULL DEFAULT 0,
    mime TEXT,
    modified_at INTEGER,
    conflict TEXT NOT NULL DEFAULT 'rename',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE nodes ADD COLUMN color TEXT;

  ALTER TABLE blobs ADD COLUMN processed INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE blobs ADD COLUMN meta TEXT;
  ALTER TABLE blobs ADD COLUMN taken_at INTEGER;
  ALTER TABLE blobs ADD COLUMN scan_status TEXT;
  ALTER TABLE blobs ADD COLUMN scan_signature TEXT;
  ALTER TABLE blobs ADD COLUMN scanned_at INTEGER;
  CREATE INDEX blobs_processed ON blobs(processed, created_at);
  CREATE INDEX blobs_scan ON blobs(scan_status, scanned_at);

  ALTER TABLE users ADD COLUMN prefs TEXT;
  ALTER TABLE links ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE invites ADD COLUMN email TEXT;

  CREATE TABLE audit (
    id INTEGER PRIMARY KEY,
    actor_id INTEGER,
    subject_id INTEGER,
    action TEXT NOT NULL,
    ip TEXT,
    details TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX audit_created ON audit(created_at);
  CREATE INDEX audit_subject ON audit(subject_id, created_at);
  CREATE INDEX audit_actor ON audit(actor_id, created_at);
  CREATE INDEX audit_action ON audit(action, created_at);

  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    link_id TEXT,
    node_id TEXT,
    parent_id TEXT,
    action TEXT NOT NULL,
    name TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    details TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX activity_owner ON activity(owner_id, created_at);
  CREATE INDEX activity_node ON activity(node_id, created_at);
  CREATE INDEX activity_parent ON activity(parent_id, created_at);
  CREATE INDEX activity_actor ON activity(actor_id, created_at);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    params TEXT,
    url TEXT,
    read_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX notifications_user ON notifications(user_id, created_at);

  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX password_resets_user ON password_resets(user_id);

  CREATE TABLE webhooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    config TEXT NOT NULL,
    events TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_at INTEGER,
    last_status INTEGER,
    last_error TEXT
  );

  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX comments_node ON comments(node_id, created_at);

  CREATE TABLE blob_text (
    id INTEGER PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE REFERENCES blobs(sha256) ON DELETE CASCADE,
    content TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE blob_text_fts USING fts5(content, content='blob_text', content_rowid='id', tokenize='unicode61 remove_diacritics 2');

  CREATE TRIGGER blob_text_insert AFTER INSERT ON blob_text BEGIN
    INSERT INTO blob_text_fts(rowid, content) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER blob_text_delete AFTER DELETE ON blob_text BEGIN
    INSERT INTO blob_text_fts(blob_text_fts, rowid, content) VALUES ('delete', old.id, old.content);
  END;
  CREATE TRIGGER blob_text_update AFTER UPDATE OF content ON blob_text BEGIN
    INSERT INTO blob_text_fts(blob_text_fts, rowid, content) VALUES ('delete', old.id, old.content);
    INSERT INTO blob_text_fts(rowid, content) VALUES (new.id, new.content);
  END;
  `,
  `
  CREATE TABLE groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );
  CREATE INDEX group_members_user ON group_members(user_id);

  CREATE TABLE group_grants (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (node_id, group_id)
  );
  CREATE INDEX group_grants_group ON group_grants(group_id);
  CREATE INDEX group_grants_owner ON group_grants(owner_id);

  ALTER TABLE links ADD COLUMN max_downloads INTEGER;
  ALTER TABLE links ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE tags (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (owner_id, name_key)
  );

  CREATE TABLE node_tags (
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (tag_id, node_id)
  );
  CREATE INDEX node_tags_node ON node_tags(node_id);

  CREATE TABLE albums (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cover_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX albums_owner ON albums(owner_id);

  CREATE TABLE album_items (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (album_id, node_id)
  );
  CREATE INDEX album_items_node ON album_items(node_id);
  CREATE TABLE positions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL,
    seconds REAL NOT NULL,
    duration REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, node_id)
  );
  CREATE INDEX positions_node ON positions(node_id);
  ALTER TABLE grants ADD COLUMN expires_at INTEGER;
  ALTER TABLE group_grants ADD COLUMN expires_at INTEGER;
  CREATE TABLE watches (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, node_id)
  );
  CREATE INDEX watches_node ON watches(node_id);
  `,
  `
  CREATE TABLE searches (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    query TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX searches_user ON searches(user_id, created_at);

  ALTER TABLE nodes ADD COLUMN media_at INTEGER;
  UPDATE nodes SET media_at = COALESCE((SELECT taken_at FROM blobs WHERE blobs.sha256 = nodes.sha256), modified_at)
    WHERE type = 'file' AND (mime LIKE 'image/%' OR mime LIKE 'video/%');
  CREATE INDEX nodes_media ON nodes(owner_id, media_at, seq) WHERE media_at IS NOT NULL AND trashed_at IS NULL;

  CREATE TRIGGER nodes_media_insert AFTER INSERT ON nodes
  WHEN NEW.type = 'file' AND (NEW.mime LIKE 'image/%' OR NEW.mime LIKE 'video/%') BEGIN
    UPDATE nodes SET media_at = COALESCE((SELECT taken_at FROM blobs WHERE sha256 = NEW.sha256), NEW.modified_at) WHERE seq = NEW.seq;
  END;
  CREATE TRIGGER nodes_media_update AFTER UPDATE OF sha256, mime, modified_at, type ON nodes BEGIN
    UPDATE nodes SET media_at = CASE
      WHEN NEW.type = 'file' AND (NEW.mime LIKE 'image/%' OR NEW.mime LIKE 'video/%')
      THEN COALESCE((SELECT taken_at FROM blobs WHERE sha256 = NEW.sha256), NEW.modified_at)
      ELSE NULL END
    WHERE seq = NEW.seq;
  END;
  CREATE TRIGGER blobs_media_taken AFTER UPDATE OF taken_at ON blobs BEGIN
    UPDATE nodes SET media_at = COALESCE(NEW.taken_at, modified_at) WHERE sha256 = NEW.sha256 AND media_at IS NOT NULL;
  END;

  CREATE TABLE devices (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    agent TEXT,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, hash)
  );

  CREATE TABLE rules (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    days INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    run_at INTEGER
  );
  CREATE INDEX rules_user ON rules(user_id);

  CREATE TABLE usage_days (
    day TEXT PRIMARY KEY,
    users INTEGER NOT NULL,
    files INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    stored INTEGER NOT NULL
  );
  `,
];

export const pendingMigrations = (database: DatabaseSync) =>
  MIGRATIONS.length - (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

export function migrate(database: DatabaseSync, until = MIGRATIONS.length) {
  const row = database.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;
  for (let version = current; version < Math.min(until, MIGRATIONS.length); version++) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(MIGRATIONS[version]);
      database.exec(`PRAGMA user_version = ${version + 1}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export const schemaVersion = () => MIGRATIONS.length;
