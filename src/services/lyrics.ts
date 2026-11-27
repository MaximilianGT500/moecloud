import { open } from 'node:fs/promises';
import { all } from '../lib/db.ts';
import { badRequest } from '../lib/errors.ts';
import { kindOf } from '../lib/mime.ts';
import { splitName } from '../lib/names.ts';
import { blobPath, typeOf } from './blobs.ts';
import { requireAccess, resolveAccess, type NodeRow } from './nodes.ts';
import { assertNotInfected } from './scan.ts';
import type { UserRow } from './users.ts';

export interface LyricLine {
  time: number | null;
  text: string;
}

export interface Lyrics {
  source: 'file' | 'tags' | null;
  synced: boolean;
  lines: LyricLine[];
}

const SIDECAR_LIMIT = 512 * 1024;
const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(text: string): LyricLine[] {
  let offset = 0;
  const timed: LyricLine[] = [];
  const plain: LyricLine[] = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const meta = /^\[(ar|ti|al|by|re|ve|length|au|#|offset):([^\]]*)\]$/i.exec(line);
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') offset = Number.parseInt(meta[2], 10) || 0;
      continue;
    }
    const stamps = [...line.matchAll(STAMP)];
    if (!stamps.length) {
      if (line) plain.push({ time: null, text: line });
      continue;
    }
    const words = line
      .replace(STAMP, '')
      .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
      .trim();
    for (const stamp of stamps) {
      const fraction = stamp[3] ? Number(stamp[3].padEnd(3, '0').slice(0, 3)) : 0;
      const ms = (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000 + fraction - offset;
      timed.push({ time: Math.max(0, ms) / 1000, text: words });
    }
  }
  if (timed.length) return timed.sort((a, b) => (a.time ?? 0) - (b.time ?? 0)).slice(0, 5000);
  return plain.slice(0, 5000);
}

const isAudio = (node: NodeRow) => node.type === 'file' && kindOf(node.name, typeOf(node, null)) === 'audio';

async function readSmall(node: NodeRow) {
  if (!node.sha256 || node.size > SIDECAR_LIMIT) return null;
  assertNotInfected(node.sha256);
  const handle = await open(blobPath(node.sha256), 'r');
  try {
    const buffer = Buffer.alloc(node.size);
    const { bytesRead } = await handle.read(buffer, 0, node.size, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function sidecar(user: UserRow, node: NodeRow) {
  if (!node.parent_id) return null;
  const [base] = splitName(node.name);
  const rows = all<NodeRow>("SELECT * FROM nodes WHERE parent_id = ? AND type = 'file' AND trashed_at IS NULL", node.parent_id);
  const wanted = `${base}.lrc`.toLowerCase();
  const found = rows.find((row) => row.name.toLowerCase() === wanted);
  if (!found) return null;
  return resolveAccess(user, found.id) ? found : null;
}

export async function lyricsFor(user: UserRow, id: string): Promise<Lyrics> {
  const { node } = requireAccess(user, id);
  if (!isAudio(node)) throw badRequest('Das ist keine Musik');
  const file = sidecar(user, node);
  if (file) {
    const text = await readSmall(file).catch(() => null);
    const lines = text ? parseLrc(text) : [];
    if (lines.length) return { source: 'file', synced: lines[0].time !== null, lines };
  }
  if (!node.sha256) return { source: null, synced: false, lines: [] };
  assertNotInfected(node.sha256);
  try {
    const { parseFile } = await import('music-metadata');
    const tags = await parseFile(blobPath(node.sha256), { skipCovers: true, duration: false });
    for (const entry of tags.common.lyrics ?? []) {
      if (entry.syncText?.length && entry.timeStampFormat === 2) {
        const lines = entry.syncText
          .filter((line) => typeof line.timestamp === 'number')
          .map((line) => ({ time: (line.timestamp ?? 0) / 1000, text: line.text.trim() }));
        if (lines.length) return { source: 'tags', synced: true, lines: lines.slice(0, 5000) };
      }
      const text = entry.text ?? entry.syncText?.map((line) => line.text).join('\n') ?? '';
      if (text.trim()) {
        const lines = parseLrc(text);
        if (lines.length) return { source: 'tags', synced: lines[0].time !== null, lines };
      }
    }
  } catch {}
  return { source: null, synced: false, lines: [] };
}
