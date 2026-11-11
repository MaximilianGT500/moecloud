import { one, run } from '../lib/db.ts';
import { badRequest } from '../lib/errors.ts';
import { MAX_SUBTITLE, SUBTITLE, subtitleLanguage } from '../lib/subtitles.ts';
import { getBlob } from './blobs.ts';
import { requireAccess, type NodeRow } from './nodes.ts';
import type { UserRow } from './users.ts';

export function subtitlesOf(video: NodeRow, siblings: NodeRow[]) {
  return siblings
    .filter((node) => node.type === 'file' && node.id !== video.id && node.sha256 && node.size <= MAX_SUBTITLE && SUBTITLE.test(node.name))
    .filter((node) => getBlob(node.sha256!)?.scan_status !== 'infected')
    .flatMap((node) => {
      const lang = subtitleLanguage(video.name, node.name);
      return lang === undefined ? [] : [{ id: node.id, name: node.name, lang }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function subtitleNode(node: NodeRow) {
  if (node.type !== 'file' || !node.sha256 || !SUBTITLE.test(node.name)) throw badRequest('Das ist keine Untertiteldatei');
  if (node.size > MAX_SUBTITLE) throw badRequest('Die Untertiteldatei ist zu groß');
  if (getBlob(node.sha256)?.scan_status === 'infected') throw badRequest('Diese Datei enthält Schadsoftware und ist gesperrt');
  return node;
}

export function getPosition(user: UserRow, id: string) {
  const { node } = requireAccess(user, id);
  if (node.type !== 'file' || !node.sha256) return null;
  return (
    one<{ seconds: number; duration: number; updated_at: number }>(
      'SELECT seconds, duration, updated_at FROM positions WHERE user_id = ? AND node_id = ? AND sha256 = ?',
      user.id,
      node.id,
      node.sha256
    ) ?? null
  );
}

export function savePosition(user: UserRow, id: string, seconds: number, duration: number) {
  const { node } = requireAccess(user, id);
  if (node.type !== 'file' || !node.sha256) throw badRequest('Das geht nur mit Dateien');
  if (seconds < 5 || duration < 60 || duration - seconds < 15) {
    run('DELETE FROM positions WHERE user_id = ? AND node_id = ?', user.id, node.id);
    return null;
  }
  const now = Date.now();
  run(
    `INSERT INTO positions (user_id, node_id, sha256, seconds, duration, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, node_id) DO UPDATE SET sha256 = excluded.sha256, seconds = excluded.seconds, duration = excluded.duration, updated_at = excluded.updated_at`,
    user.id,
    node.id,
    node.sha256,
    seconds,
    duration,
    now
  );
  return { seconds, duration, updated_at: now };
}
