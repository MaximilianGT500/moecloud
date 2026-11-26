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
  `
  ALTER TABLE users ADD COLUMN expires_at INTEGER;

  CREATE TABLE locks (
    node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );
  CREATE INDEX locks_user ON locks(user_id);

  ALTER TABLE links ADD COLUMN notify_downloads INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE links ADD COLUMN notified_at INTEGER;

  ALTER TABLE nodes ADD COLUMN description TEXT;

  CREATE TABLE reminders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    due_at INTEGER NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX reminders_user_node ON reminders(user_id, node_id);
  CREATE INDEX reminders_due ON reminders(due_at);

  ALTER TABLE links ADD COLUMN slug TEXT;
  ALTER TABLE links ADD COLUMN warned_at INTEGER;
  CREATE UNIQUE INDEX links_slug ON links(slug);

  CREATE TABLE link_events (
    id TEXT PRIMARY KEY,
    link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    name TEXT,
    agent TEXT,
    at INTEGER NOT NULL
  );
  CREATE INDEX link_events_link ON link_events(link_id, at);

  CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    link_id TEXT REFERENCES links(id) ON DELETE SET NULL,
    owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    label TEXT NOT NULL,
    reason TEXT NOT NULL,
    text TEXT,
    contact TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  CREATE INDEX reports_open ON reports(resolved_at, created_at);

  ALTER TABLE notifications ADD COLUMN mail_state INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE notifications ADD COLUMN push_state INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    agent TEXT,
    origin TEXT,
    created_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);
  `,
  `
  CREATE TABLE plugin_store (
    plugin TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plugin, key)
  );
  `,
  `
  CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT,
    created_by INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE team_managers (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (team_id, user_id)
  );
  CREATE INDEX team_managers_user ON team_managers(user_id);
  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    deep INTEGER NOT NULL DEFAULT 0,
    conditions TEXT NOT NULL,
    actions TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    runs INTEGER NOT NULL DEFAULT 0,
    run_at INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX automations_node ON automations(node_id);
  CREATE INDEX automations_user ON automations(user_id);
  ALTER TABLE users ADD COLUMN terms_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN terms_at INTEGER;
  ALTER TABLE users ADD COLUMN avatar TEXT;
  ALTER TABLE versions ADD COLUMN label TEXT;
  ALTER TABLE invites ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
  ALTER TABLE invites ADD COLUMN team_id INTEGER;
  ALTER TABLE invites ADD COLUMN team_role TEXT;
  `,
  `
  CREATE TABLE office_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    origin TEXT NOT NULL DEFAULT '',
    expires_at INTEGER NOT NULL,
    saved_at INTEGER
  );
  CREATE INDEX office_tokens_expires ON office_tokens(expires_at);
  CREATE INDEX office_tokens_node ON office_tokens(node_id);
  CREATE INDEX office_tokens_user ON office_tokens(user_id);
  ALTER TABLE app_passwords ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';
  ALTER TABLE app_passwords ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE app_passwords ADD COLUMN expires_at INTEGER;
  ALTER TABLE grants ADD COLUMN note TEXT;
  ALTER TABLE group_grants ADD COLUMN note TEXT;
  ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN seen_at INTEGER;
  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX playlists_owner ON playlists(owner_id);
  CREATE TABLE playlist_items (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, node_id)
  );
  CREATE INDEX playlist_items_node ON playlist_items(node_id);
  `,
  `
  ALTER TABLE nodes ADD COLUMN icon TEXT;
  ALTER TABLE links ADD COLUMN starts_at INTEGER;
  ALTER TABLE links ADD COLUMN message TEXT;
  ALTER TABLE links ADD COLUMN theme TEXT;
  CREATE TABLE plays (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 0,
    played_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, node_id)
  );
  CREATE INDEX plays_recent ON plays(user_id, played_at);
  CREATE INDEX plays_node ON plays(node_id);
  CREATE TABLE email_confirmations (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX email_confirmations_user ON email_confirmations(user_id);
  `,
  `
  UPDATE app_passwords SET scope = 'admin' WHERE scope = 'full' AND user_id IN (SELECT id FROM users WHERE role = 'admin');
  ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE forms (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    questions TEXT NOT NULL DEFAULT '[]',
    token TEXT NOT NULL UNIQUE,
    accepting INTEGER NOT NULL DEFAULT 1,
    closes_at INTEGER,
    max_responses INTEGER,
    once INTEGER NOT NULL DEFAULT 0,
    signed_in INTEGER NOT NULL DEFAULT 0,
    named INTEGER NOT NULL DEFAULT 0,
    notify INTEGER NOT NULL DEFAULT 1,
    confirmation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX forms_owner ON forms(owner_id, updated_at);
  CREATE TABLE form_responses (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    respondent TEXT,
    answers TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX form_responses_form ON form_responses(form_id, created_at);
  CREATE INDEX form_responses_respondent ON form_responses(form_id, respondent);
  CREATE TABLE comment_reactions (
    comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (comment_id, user_id, emoji)
  );
  CREATE INDEX comment_reactions_user ON comment_reactions(user_id);
  ALTER TABLE app_passwords ADD COLUMN paused_at INTEGER;
  ALTER TABLE app_passwords ADD COLUMN paused_reason TEXT;
  `,
  `
  CREATE TABLE calendars (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'local',
    components TEXT NOT NULL DEFAULT 'VEVENT,VTODO',
    zone TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    alarms TEXT,
    allday_alarms TEXT,
    public_token TEXT UNIQUE,
    public_mode TEXT,
    source_url TEXT,
    refresh_minutes INTEGER,
    synced_at INTEGER,
    sync_error TEXT,
    sync_etag TEXT,
    sync_failures INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    trashed_at INTEGER
  );
  CREATE UNIQUE INDEX calendars_slug ON calendars(owner_id, slug);
  CREATE INDEX calendars_owner ON calendars(owner_id, position);
  CREATE INDEX calendars_kind ON calendars(kind, synced_at);

  CREATE TABLE calendar_shares (
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    color TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    notify INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (calendar_id, user_id)
  );
  CREATE INDEX calendar_shares_user ON calendar_shares(user_id);

  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    uid TEXT NOT NULL,
    href TEXT NOT NULL,
    component TEXT NOT NULL,
    title TEXT NOT NULL,
    location TEXT,
    description TEXT,
    categories TEXT,
    start_at INTEGER,
    end_at INTEGER,
    all_day INTEGER NOT NULL DEFAULT 0,
    recurring INTEGER NOT NULL DEFAULT 0,
    range_end INTEGER,
    status TEXT,
    due_at INTEGER,
    completed_at INTEGER,
    has_alarms INTEGER NOT NULL DEFAULT 0,
    organizer_id INTEGER,
    data TEXT NOT NULL,
    ics TEXT NOT NULL,
    etag TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    updated_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    trashed_at INTEGER
  );
  CREATE UNIQUE INDEX events_href ON events(calendar_id, href);
  CREATE INDEX events_uid ON events(calendar_id, uid);
  CREATE INDEX events_range ON events(calendar_id, trashed_at, start_at, range_end);
  CREATE INDEX events_trash ON events(trashed_at);
  CREATE INDEX events_due ON events(calendar_id, component, due_at);

  CREATE TABLE attendees (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'NEEDS-ACTION',
    role TEXT,
    token_hash TEXT UNIQUE,
    calendar_id TEXT REFERENCES calendars(id) ON DELETE SET NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    notified_at INTEGER,
    responded_at INTEGER,
    comment TEXT,
    PRIMARY KEY (event_id, email)
  );
  CREATE INDEX attendees_user ON attendees(user_id, hidden);

  CREATE TABLE changes (
    calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
    href TEXT NOT NULL,
    revision INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (calendar_id, href)
  );
  CREATE INDEX changes_revision ON changes(calendar_id, revision);

  CREATE TABLE alarms (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    next_at INTEGER NOT NULL,
    occurrence INTEGER NOT NULL,
    action TEXT NOT NULL,
    fired_until INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, user_id)
  );
  CREATE INDEX alarms_next ON alarms(next_at);

  CREATE TABLE event_templates (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX event_templates_user ON event_templates(user_id, position);

  CREATE TABLE booking_pages (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    calendar_id TEXT REFERENCES calendars(id) ON DELETE SET NULL,
    durations TEXT NOT NULL,
    availability TEXT NOT NULL,
    zone TEXT NOT NULL,
    buffer_before INTEGER NOT NULL DEFAULT 0,
    buffer_after INTEGER NOT NULL DEFAULT 0,
    notice_minutes INTEGER NOT NULL DEFAULT 0,
    window_days INTEGER NOT NULL DEFAULT 60,
    max_per_day INTEGER NOT NULL DEFAULT 0,
    step_minutes INTEGER NOT NULL DEFAULT 30,
    conflicts TEXT,
    location_kind TEXT NOT NULL DEFAULT 'none',
    location TEXT,
    questions TEXT,
    color TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX booking_pages_owner ON booking_pages(owner_id);

  CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
    event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    notes TEXT,
    answers TEXT,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    zone TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    cancelled_at INTEGER
  );
  CREATE INDEX bookings_page ON bookings(page_id, start_at);

  CREATE TABLE polls (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    zone TEXT NOT NULL,
    options TEXT NOT NULL,
    settings TEXT,
    deadline INTEGER,
    closed_at INTEGER,
    final_option TEXT,
    event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX polls_owner ON polls(owner_id, created_at);

  CREATE TABLE poll_votes (
    id TEXT PRIMARY KEY,
    poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    answers TEXT NOT NULL,
    comment TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX poll_votes_poll ON poll_votes(poll_id, created_at);
  ALTER TABLE nodes ADD COLUMN expires_at INTEGER;
  ALTER TABLE nodes ADD COLUMN expires_by INTEGER;
  CREATE INDEX nodes_expiry ON nodes(expires_at) WHERE expires_at IS NOT NULL;

  CREATE TABLE address_books (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX address_books_slug ON address_books(owner_id, slug);

  CREATE TABLE address_book_shares (
    book_id TEXT NOT NULL REFERENCES address_books(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    created_by INTEGER,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (book_id, user_id)
  );
  CREATE INDEX address_book_shares_user ON address_book_shares(user_id);

  CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL REFERENCES address_books(id) ON DELETE CASCADE,
    uid TEXT NOT NULL,
    href TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'individual',
    name TEXT NOT NULL,
    search TEXT NOT NULL,
    birthday TEXT,
    data TEXT NOT NULL,
    vcard TEXT NOT NULL,
    etag TEXT NOT NULL,
    created_by INTEGER,
    updated_by INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    trashed_at INTEGER
  );
  CREATE UNIQUE INDEX contacts_href ON contacts(book_id, href);
  CREATE INDEX contacts_uid ON contacts(book_id, uid);
  CREATE INDEX contacts_book ON contacts(book_id, trashed_at);
  CREATE INDEX contacts_trash ON contacts(trashed_at);

  CREATE TABLE contact_emails (
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    PRIMARY KEY (contact_id, email)
  );
  CREATE INDEX contact_emails_email ON contact_emails(email);

  CREATE TABLE contact_stars (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, contact_id)
  );
  CREATE INDEX contact_stars_contact ON contact_stars(contact_id);

  CREATE TABLE contact_changes (
    book_id TEXT NOT NULL REFERENCES address_books(id) ON DELETE CASCADE,
    href TEXT NOT NULL,
    revision INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (book_id, href)
  );
  CREATE INDEX contact_changes_revision ON contact_changes(book_id, revision);
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
