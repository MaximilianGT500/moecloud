import { all, one, run } from '../lib/db.ts';
import { publish } from '../lib/events.ts';

export const STATES = ['available', 'busy', 'away', 'dnd'] as const;
export type StatusState = (typeof STATES)[number];

export interface UserStatus {
  state: StatusState;
  emoji: string;
  text: string;
  until: number | null;
}

interface StatusRow {
  user_id: number;
  state: StatusState;
  emoji: string;
  text: string;
  until: number | null;
  updated_at: number;
}

const fresh = (row: StatusRow | undefined, now = Date.now()) => Boolean(row) && (!row!.until || row!.until > now);

const present = (row: StatusRow): UserStatus => ({ state: row.state, emoji: row.emoji, text: row.text, until: row.until });

export function statusOf(userId: number, now = Date.now()): UserStatus | null {
  const row = one<StatusRow>('SELECT * FROM user_status WHERE user_id = ?', userId);
  return row && fresh(row, now) ? present(row) : null;
}

export function statusMap(ids: Iterable<number>, now = Date.now()) {
  const list = [...new Set(ids)];
  const map = new Map<number, UserStatus>();
  if (!list.length) return map;
  for (let start = 0; start < list.length; start += 500) {
    const chunk = list.slice(start, start + 500);
    for (const row of all<StatusRow>(`SELECT * FROM user_status WHERE user_id IN (${chunk.map(() => '?').join(', ')})`, ...chunk)) {
      if (fresh(row, now)) map.set(row.user_id, present(row));
    }
  }
  return map;
}

export const dndActive = (userId: number, now = Date.now()) => statusOf(userId, now)?.state === 'dnd';

export function setStatus(userId: number, status: UserStatus | null) {
  if (!status) run('DELETE FROM user_status WHERE user_id = ?', userId);
  else {
    run(
      `INSERT INTO user_status (user_id, state, emoji, text, until, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, emoji = excluded.emoji, text = excluded.text, until = excluded.until, updated_at = excluded.updated_at`,
      userId,
      status.state,
      status.emoji,
      status.text,
      status.until,
      Date.now()
    );
  }
  publish([userId], 'status', { status: statusOf(userId) });
  return statusOf(userId);
}

export function purgeStatuses(now = Date.now()) {
  return run('DELETE FROM user_status WHERE until IS NOT NULL AND until <= ?', now).changes;
}
