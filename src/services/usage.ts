import { all, run, value } from '../lib/db.ts';

const DAY = 24 * 60 * 60 * 1000;
const EVERY = 60 * 60 * 1000;
const KEEP = 3 * 366;

interface UsageRow {
  day: string;
  users: number;
  files: number;
  bytes: number;
  stored: number;
}

let last = 0;

export const dayOf = (time = Date.now()) => new Date(time).toISOString().slice(0, 10);

export function recordUsage(now = Date.now(), force = false) {
  if (!force && now - last < EVERY) return false;
  last = now;
  run(
    `INSERT INTO usage_days (day, users, files, bytes, stored) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET users = excluded.users, files = excluded.files, bytes = excluded.bytes, stored = excluded.stored`,
    dayOf(now),
    value<number>('SELECT COUNT(*) FROM users') ?? 0,
    value<number>("SELECT COUNT(*) FROM nodes WHERE type = 'file'") ?? 0,
    value<number>("SELECT COALESCE(SUM(size), 0) FROM nodes WHERE type = 'file'") ?? 0,
    value<number>('SELECT COALESCE(SUM(size), 0) FROM blobs') ?? 0
  );
  run('DELETE FROM usage_days WHERE day < ?', dayOf(now - KEEP * DAY));
  return true;
}

export const usageHistory = (days = 365, now = Date.now()) =>
  all<UsageRow>('SELECT * FROM usage_days WHERE day >= ? ORDER BY day', dayOf(now - (days - 1) * DAY)).map((row) => ({
    day: row.day,
    users: Number(row.users),
    files: Number(row.files),
    bytes: Number(row.bytes),
    stored: Number(row.stored),
  }));
