import type { Dirent } from 'node:fs';
import { open, readdir, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';
import { run, tx } from '../lib/db.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { kindOf, mimeOf, type Kind } from '../lib/mime.ts';
import { uniqueName } from '../lib/names.ts';
import { audit } from './audit.ts';
import { documentText } from './archive.ts';
import { getBlob, hashFile } from './blobs.ts';
import { pdfText, probe, tools } from './media.ts';
import { ensurePath, insertNode, taken } from './nodes.ts';
import { imageMeta } from './processing.ts';
import { preferredLanguage, quotaOf, usageOf, type UserRow } from './users.ts';

const SHA = /^[0-9a-f]{64}$/;
const FAN = /^[0-9a-f]{2}$/;
const HEAD = 64 * 1024;
const NAME_BYTES = 200;

const RAW_MAKES: [RegExp, string][] = [
  [/^nikon/i, 'nef'],
  [/^sony/i, 'arw'],
  [/^(pentax|ricoh)/i, 'pef'],
  [/^samsung/i, 'srw'],
  [/^hasselblad/i, '3fr'],
  [/^kodak/i, 'dcr'],
  [/^leaf/i, 'mos'],
  [/^mamiya/i, 'mef'],
  [/^phase one/i, 'iiq'],
  [/epson/i, 'erf'],
  [/^apple/i, 'dng'],
];

const RAW_MAGIC: [string, number, string][] = [
  ['FOVb', 0, 'x3f'],
  ['\u0000MRM', 0, 'mrw'],
  ['HEAPCCDR', 6, 'crw'],
];

const AUDIO_ONLY: Record<string, string> = { mp4: 'm4a', mkv: 'mka', webm: 'weba', asf: 'wma' };
const PLAIN_TEXT = new Set(['md', 'txt']);
const OFFICE_TEXT = new Set(['docx', 'odt', 'pptx', 'odp']);
const HINT_LENGTH = 60;

const MSI = Buffer.from('84100c0000000000c000000000000046', 'hex');

export interface Stray {
  sha: string;
  path: string;
  size: number;
  modified: number;
}

export interface Progress {
  done: number;
  total: number;
  bytes: number;
  totalBytes: number;
}

export type Tally = Partial<Record<Kind, { count: number; bytes: number }>>;

export interface Survey {
  count: number;
  bytes: number;
  kinds: Tally;
  foreign: number;
  known: number;
  unreadable: Unreadable[];
}

export interface Recovered {
  imported: number;
  bytes: number;
  kinds: Tally;
  corrupted: string[];
  foreign: number;
  known: number;
  unreadable: Unreadable[];
  folder: string;
  overQuota: number | null;
}

interface Plan {
  kind: Kind;
  folders: string[];
  name: string;
  date: number;
}

export function folderOf(kind: Kind, lang: Lang) {
  switch (kind) {
    case 'image':
      return t(lang, 'Bilder');
    case 'video':
      return t(lang, 'Videos');
    case 'audio':
      return t(lang, 'Audio');
    case 'pdf':
      return t(lang, 'PDFs');
    case 'document':
      return t(lang, 'Dokumente');
    case 'spreadsheet':
      return t(lang, 'Tabellen');
    case 'presentation':
      return t(lang, 'Präsentationen');
    case 'text':
      return t(lang, 'Texte');
    case 'code':
      return t(lang, 'Code');
    case 'archive':
      return t(lang, 'Archive');
    default:
      return t(lang, 'Sonstiges');
  }
}

export interface Unreadable {
  path: string;
  code: string;
}

export interface Scan {
  strays: Stray[];
  foreign: string[];
  known: number;
  unreadable: Unreadable[];
}

export async function listDir(dir: string, unreadable: Unreadable[]) {
  try {
    return (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'EIO';
    if (code !== 'ENOENT') unreadable.push({ path: dir, code });
    return [] as Dirent[];
  }
}

export async function findStrays(): Promise<Scan> {
  const scan: Scan = { strays: [], foreign: [], known: 0, unreadable: [] };
  const root = config.paths.blobs;
  for (const first of await listDir(root, scan.unreadable)) {
    const firstPath = join(root, first.name);
    if (!first.isDirectory() || !FAN.test(first.name)) {
      scan.foreign.push(firstPath);
      continue;
    }
    for (const second of await listDir(firstPath, scan.unreadable)) {
      const secondPath = join(firstPath, second.name);
      if (!second.isDirectory() || !FAN.test(second.name)) {
        scan.foreign.push(secondPath);
        continue;
      }
      for (const entry of await listDir(secondPath, scan.unreadable)) {
        const path = join(secondPath, entry.name);
        if (!entry.isFile() || !SHA.test(entry.name) || !entry.name.startsWith(first.name + second.name)) {
          scan.foreign.push(path);
          continue;
        }
        if (getBlob(entry.name)) {
          scan.known++;
          continue;
        }
        const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
          scan.unreadable.push({ path, code: error.code ?? 'EIO' });
          return null;
        });
        if (info) scan.strays.push({ sha: entry.name, path, size: info.size, modified: info.mtimeMs });
      }
    }
  }
  scan.strays.sort((a, b) => a.modified - b.modified || a.sha.localeCompare(b.sha));
  return scan;
}

async function readAt(handle: FileHandle, position: number, length: number) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

async function head(path: string) {
  const handle = await open(path, 'r');
  try {
    return await readAt(handle, 0, HEAD);
  } finally {
    await handle.close();
  }
}

function tiffRaw(data: Buffer) {
  if (data.length < 8) return null;
  const order = data.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const little = order === 'II';
  const u16 = (at: number) => (little ? data.readUInt16LE(at) : data.readUInt16BE(at));
  const u32 = (at: number) => (little ? data.readUInt32LE(at) : data.readUInt32BE(at));
  if (u16(2) !== 42) return null;
  const directory = u32(4);
  if (directory + 2 > data.length) return null;
  let make = '';
  let raw = false;
  for (let index = 0; index < u16(directory); index++) {
    const at = directory + 2 + index * 12;
    if (at + 12 > data.length) break;
    const tag = u16(at);
    if (tag === 50706) return 'dng';
    if (tag === 330) raw = true;
    if (tag === 254 && (u16(at + 2) === 3 ? u16(at + 8) : u32(at + 8)) === 1) raw = true;
    if (tag === 271) {
      const length = u32(at + 4);
      const offset = length <= 4 ? at + 8 : u32(at + 8);
      make = data
        .toString('latin1', offset, Math.min(offset + length, data.length))
        .replace(/\0[\s\S]*$/, '')
        .trim();
    }
  }
  if (!raw) return null;
  return RAW_MAKES.find(([pattern]) => pattern.test(make))?.[1] ?? null;
}

async function compound(path: string) {
  const handle = await open(path, 'r');
  try {
    const header = await readAt(handle, 0, 512);
    if (header.length < 512) return null;
    const sector = 2 ** header.readUInt16LE(30);
    if (sector !== 512 && sector !== 4096) return null;
    const fat: number[] = [];
    for (let index = 0; index < Math.min(header.readUInt32LE(44), 109); index++) {
      const at = header.readUInt32LE(76 + index * 4);
      if (at >= 0xfffffffa) break;
      const block = await readAt(handle, (at + 1) * sector, sector);
      for (let offset = 0; offset + 4 <= block.length; offset += 4) fat.push(block.readUInt32LE(offset));
    }
    const names = new Set<string>();
    let root: Buffer | null = null;
    let current = header.readUInt32LE(48);
    for (let hops = 0; hops < 256 && current < 0xfffffffa; hops++) {
      const block = await readAt(handle, (current + 1) * sector, sector);
      for (let at = 0; at + 128 <= block.length; at += 128) {
        const length = block.readUInt16LE(at + 64);
        if (length < 2 || length > 64) continue;
        const name = block.toString('utf16le', at, at + length - 2);
        if (block[at + 66] === 5) root = block.subarray(at + 80, at + 96);
        names.add(name);
      }
      current = fat[current] ?? 0xfffffffe;
    }
    if (names.has('WordDocument')) return 'doc';
    if (names.has('Workbook') || names.has('Book')) return 'xls';
    if (names.has('PowerPoint Document')) return 'ppt';
    if (names.has('VisioDocument')) return 'vsd';
    if ([...names].some((name) => name.startsWith('__substg1.0_'))) return 'msg';
    if (root?.equals(MSI)) return 'msi';
    return null;
  } finally {
    await handle.close();
  }
}

function decodeText(data: Buffer) {
  let text: string;
  if (data[0] === 0xff && data[1] === 0xfe) text = data.subarray(2).toString('utf16le');
  else if (data[0] === 0xfe && data[1] === 0xff)
    text = Buffer.from(data.subarray(2, 2 + ((data.length - 2) & ~1)))
      .swap16()
      .toString('utf16le');
  else text = data.toString('utf8');
  return /[\u0000-\u0008\u000b\u000e-\u001a\u001c-\u001f]/.test(text) ? null : text.replace(/^﻿/, '');
}

function delimited(text: string, whole: boolean) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!whole) lines.pop();
  const sample = lines.slice(0, 12);
  if (sample.length < 3) return null;
  for (const [mark, ext] of [
    ['\t', 'tsv'],
    [';', 'csv'],
    [',', 'csv'],
  ] as const) {
    const counts = sample.map((line) => line.split(mark).length - 1);
    if (counts[0] > 0 && counts.every((count) => count === counts[0])) return ext;
  }
  return null;
}

function json(text: string, whole: boolean) {
  if (!whole) return /^[[{]\s*["[{\]}]/.test(text);
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const markdown = (text: string) =>
  /^#{1,6} \S/.test(text) ||
  /^```/m.test(text) ||
  (/^#{1,6} \S/m.test(text) && /^\s*(?:[-*+]|\d+\.) \S|\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*\n]+\*\*/m.test(text));

function textExtension(text: string, whole: boolean) {
  const start = text.trimStart();
  const lower = start.slice(0, 2048).toLowerCase();
  if (lower.startsWith('{\\rtf')) return 'rtf';
  if (lower.startsWith('<')) {
    if (/<svg[\s>]/.test(lower)) return 'svg';
    if (lower.startsWith('<!doctype html') || /<html[\s>]/.test(lower)) return 'html';
    if (/<gpx[\s>]/.test(lower)) return 'gpx';
    if (/<kml[\s>]/.test(lower)) return 'kml';
    if (lower.includes('<plist')) return 'plist';
    if (lower.startsWith('<?xml')) return 'xml';
  }
  if (lower.startsWith('begin:vcard')) return 'vcf';
  if (lower.startsWith('begin:vcalendar')) return 'ics';
  if (lower.startsWith('webvtt')) return 'vtt';
  if (/^\d+\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3} --> /.test(start)) return 'srt';
  if (start.startsWith('#!')) {
    const line = start.split('\n', 1)[0];
    if (/python/.test(line)) return 'py';
    if (/\b(node|deno|bun)\b/.test(line)) return 'js';
    return 'sh';
  }
  if (/^[[{]/.test(start) && json(start, whole)) return 'json';
  if (markdown(start)) return 'md';
  return delimited(start, whole) ?? 'txt';
}

export async function identify(path: string, size: number) {
  if (size === 0) return '';
  const { fileTypeFromFile } = await import('file-type');
  const found = await fileTypeFromFile(path).catch(() => undefined);
  if (found && found.ext !== 'tif' && found.ext !== 'cfb' && found.ext !== 'xml') return found.ext;
  if (found?.ext === 'cfb') return (await compound(path).catch(() => null)) ?? 'cfb';
  const data = await head(path);
  if (found?.ext === 'tif') return tiffRaw(data) ?? 'tif';
  const magic = RAW_MAGIC.find(([marker, at]) => data.toString('latin1', at, at + marker.length) === marker);
  if (magic) return magic[2];
  const text = decodeText(data);
  if (text === null) return found?.ext ?? 'bin';
  return textExtension(text, size <= data.length);
}

const typeOfExt = (ext: string) => (ext ? mimeOf(`x.${ext}`) : 'application/octet-stream');

const kindOfExt = (ext: string) => kindOf(ext ? `x.${ext}` : 'x', typeOfExt(ext));

const two = (value: number) => String(value).padStart(2, '0');

function stampOf(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}`;
}

const tidy = (value: unknown) =>
  typeof value === 'string'
    ? value
        .normalize('NFC')
        .replace(/[/\\\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

function shorten(text: string) {
  const letters = [...text];
  if (letters.length <= HINT_LENGTH) return text;
  const cut = letters.slice(0, HINT_LENGTH).join('');
  const space = cut.lastIndexOf(' ');
  return space > HINT_LENGTH / 2 ? cut.slice(0, space) : cut;
}

export function hintOf(text: string) {
  for (const raw of text.split(/\r?\n/).slice(0, 40)) {
    const line = raw
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^[\s#>*+•|-]+/, '')
      .replace(/[*_`~]+/g, '')
      .replace(/[:?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if ((line.match(/\p{L}/gu)?.length ?? 0) < 3) continue;
    return shorten(line)
      .replace(/[\s.,;!-]+$/, '')
      .trim();
  }
  return '';
}

async function contentHint(path: string, ext: string) {
  if (PLAIN_TEXT.has(ext)) return hintOf(decodeText(await head(path)) ?? '');
  if (ext === 'pdf' && tools.pdftotext) return hintOf(await pdfText(path, 4096, 1));
  if (OFFICE_TEXT.has(ext)) return hintOf(await documentText(path, 4096));
  return '';
}

function fileName(base: string, ext: string) {
  const suffix = ext ? `.${ext}` : '';
  let stem = [...base];
  while (stem.length > 1 && Buffer.byteLength(stem.join('') + suffix) > NAME_BYTES) stem = stem.slice(0, -1);
  return `${stem.join('').trim()}${suffix}`;
}

async function plan(stray: Stray, lang: Lang): Promise<Plan> {
  let ext = await identify(stray.path, stray.size);
  let kind = kindOfExt(ext);
  let date: number | null = null;
  let title = '';
  if (kind === 'video' && tools.ffprobe) {
    const info = await probe(stray.path).catch(() => null);
    if (info && info.width === null && info.duration !== null && ext in AUDIO_ONLY) {
      ext = AUDIO_ONLY[ext];
      kind = 'audio';
    } else if (info && ext === 'asf') {
      ext = 'wmv';
    }
    date = info?.created ?? null;
  }
  if (kind === 'image') {
    date = (await imageMeta(stray.path, typeOfExt(ext)).catch(() => null))?.takenAt ?? null;
  }
  if (kind === 'audio') {
    const { parseFile } = await import('music-metadata');
    const tags = await parseFile(stray.path, { skipCovers: true, duration: false }).catch(() => null);
    const artist = tidy(tags?.common.artist);
    const name = tidy(tags?.common.title);
    title = name ? [artist, name].filter(Boolean).join(' - ') : '';
  } else {
    title = tidy(await contentHint(stray.path, ext).catch(() => ''));
  }
  title = title.replace(/^\.+/, '').trim();
  const when = date ?? stray.modified;
  const folders = [folderOf(kind, lang)];
  if (kind === 'image' || kind === 'video') folders.push(String(new Date(when).getFullYear()));
  return { kind, folders, name: fileName(title || stampOf(when), ext), date: when };
}

const count = (tally: Tally, kind: Kind, bytes: number) => {
  const entry = tally[kind] ?? { count: 0, bytes: 0 };
  tally[kind] = { count: entry.count + 1, bytes: entry.bytes + bytes };
};

export async function surveyStrays(): Promise<Survey> {
  const { strays, foreign, known, unreadable } = await findStrays();
  const kinds: Tally = {};
  for (const stray of strays) count(kinds, kindOfExt(await identify(stray.path, stray.size).catch(() => 'bin')), stray.size);
  return {
    count: strays.length,
    bytes: strays.reduce((sum, stray) => sum + stray.size, 0),
    kinds,
    foreign: foreign.length,
    known,
    unreadable,
  };
}

export async function recoverFiles(user: UserRow, onProgress?: (progress: Progress) => void): Promise<Recovered> {
  const lang = preferredLanguage(user);
  const folder = t(lang, 'Wiederhergestellt');
  const { strays, foreign, known, unreadable } = await findStrays();
  const totalBytes = strays.reduce((sum, stray) => sum + stray.size, 0);
  const result: Recovered = {
    imported: 0,
    bytes: 0,
    kinds: {},
    corrupted: [],
    foreign: foreign.length,
    known,
    unreadable,
    folder,
    overQuota: null,
  };
  let bytes = 0;
  for (const [index, stray] of strays.entries()) {
    if ((await hashFile(stray.path).catch(() => null)) !== stray.sha) {
      result.corrupted.push(stray.path);
    } else {
      const target = await plan(stray, lang);
      const imported = tx(() => {
        if (getBlob(stray.sha)) return false;
        run('INSERT INTO blobs (sha256, size, refs, created_at) VALUES (?, ?, 0, ?)', stray.sha, stray.size, Date.now());
        const parentId = ensurePath(user.id, user.id, user.root_id, [folder, ...target.folders]);
        insertNode({
          ownerId: user.id,
          parentId,
          type: 'file',
          name: uniqueName(target.name, false, taken(parentId)),
          actorId: user.id,
          size: stray.size,
          sha256: stray.sha,
          modifiedAt: target.date,
        });
        return true;
      });
      if (imported) {
        result.imported++;
        result.bytes += stray.size;
        count(result.kinds, target.kind, stray.size);
      }
    }
    bytes += stray.size;
    onProgress?.({ done: index + 1, total: strays.length, bytes, totalBytes });
  }
  if (result.imported) {
    audit('files_recovered', { subject: user.id, details: { count: result.imported, size: result.bytes, folder } });
  }
  const quota = quotaOf(user);
  if (quota !== null && usageOf(user.id) > quota) result.overQuota = quota;
  return result;
}
