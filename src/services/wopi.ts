import { one, run } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import * as settings from './settings.ts';
import { extensionOf } from './filetypes.ts';
import { assertUnlocked, requireAccess, resolveAccess, type NodeRow } from './nodes.ts';
import { getUser, inactive, type UserRow } from './users.ts';

const TOKEN_TTL = 10 * 60 * 60 * 1000;
const FRESH = 10 * 60 * 1000;
const RETRY = 30 * 1000;
const MAX_DISCOVERY = 4 * 1024 * 1024;

export interface OfficeAction {
  edit?: string;
  view?: string;
}

interface Discovery {
  url: string;
  at: number;
  ok: boolean;
  error: string | null;
  actions: Map<string, OfficeAction>;
}

let cache: Discovery | null = null;
let pending: { url: string; promise: Promise<Discovery> } | null = null;

export const officeUrl = () => settings.get('collabora.url').trim().replace(/\/+$/, '');

export const officeEnabled = () => Boolean(officeUrl());

export function officeOrigin() {
  try {
    const url = new URL(officeUrl());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : '';
  } catch {
    return '';
  }
}

const decode = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export function parseDiscovery(xml: string) {
  const actions = new Map<string, OfficeAction>();
  for (const tag of xml.matchAll(/<action\b([^>]*?)\/?>/g)) {
    const fields: Record<string, string> = {};
    for (const field of tag[1].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) fields[field[1]] = decode(field[2]);
    const extension = (fields.ext ?? '').toLowerCase();
    const source = (fields.urlsrc ?? '').replace(/<[^>]*>/g, '');
    if (!/^[a-z0-9]{1,12}$/.test(extension) || !/^https?:\/\//i.test(source)) continue;
    const entry = actions.get(extension) ?? {};
    if (fields.name === 'edit') entry.edit ??= source;
    else if (fields.name === 'view' || fields.name === 'view_comment') entry.view ??= source;
    else continue;
    actions.set(extension, entry);
  }
  return actions;
}

async function load(url: string): Promise<Discovery> {
  try {
    const response = await fetch(`${url}/hosting/discovery`, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'application/xml, text/xml' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    if (xml.length > MAX_DISCOVERY) throw new Error('Antwort zu groß');
    const actions = parseDiscovery(xml);
    if (actions.size === 0) throw new Error('Die Antwort nennt keine Dateiformate');
    return { url, at: Date.now(), ok: true, error: null, actions };
  } catch (error) {
    const cause = (error as { cause?: { code?: string; message?: string } }).cause;
    return { url, at: Date.now(), ok: false, error: cause?.code ?? cause?.message ?? (error as Error).message, actions: new Map() };
  }
}

export async function discovery(force = false): Promise<Discovery | null> {
  const url = officeUrl();
  if (!url || !officeOrigin()) return null;
  if (!force && cache && cache.url === url && Date.now() - cache.at < (cache.ok ? FRESH : RETRY)) return cache;
  if (!pending || pending.url !== url) {
    const promise = load(url).then((result) => {
      if (officeUrl() === result.url) cache = result;
      if (pending?.promise === promise) pending = null;
      return result;
    });
    pending = { url, promise };
  }
  return pending.promise;
}

export function forgetDiscovery() {
  cache = null;
  pending = null;
}

export function knownExtensions() {
  const url = officeUrl();
  if (!url) return [];
  if (!cache || cache.url !== url || Date.now() - cache.at > FRESH) void discovery();
  return cache && cache.url === url && cache.ok
    ? [...cache.actions]
        .filter(([, action]) => action.edit)
        .map(([extension]) => extension)
        .sort()
    : [];
}

export async function officeState(force = false) {
  const found = await discovery(force);
  if (!found) return { enabled: false, ok: false, error: null, extensions: [] as string[] };
  return {
    enabled: true,
    ok: found.ok,
    error: found.error,
    extensions: [...found.actions]
      .filter(([, action]) => action.edit)
      .map(([extension]) => extension)
      .sort(),
  };
}

function writable(user: UserRow, node: NodeRow, role: string) {
  if (role !== 'owner' && role !== 'edit') return false;
  try {
    assertUnlocked(node, user.id);
    return true;
  } catch {
    return false;
  }
}

export async function openEditor(user: UserRow, nodeId: string, lang: string, base: string, origin: string) {
  const { node, role } = requireAccess(user, nodeId);
  if (node.type !== 'file' || node.trashed_at) throw badRequest('Nur Dateien lassen sich in Office öffnen');
  const found = await discovery();
  if (!found) throw badRequest('Office ist auf diesem Server nicht eingerichtet');
  if (!found.ok) throw new HttpError(503, 'Office ist gerade nicht erreichbar', 'office_unavailable');
  const action = found.actions.get(extensionOf(node.name));
  const write = writable(user, node, role);
  const source = write ? action?.edit : (action?.view ?? action?.edit);
  if (!source) throw badRequest('Dieses Format lässt sich nicht in Office öffnen');
  run('DELETE FROM office_tokens WHERE expires_at <= ?', Date.now());
  const token = randomId(48);
  const expires = Date.now() + TOKEN_TTL;
  run(
    'INSERT INTO office_tokens (token_hash, user_id, node_id, origin, expires_at) VALUES (?, ?, ?, ?, ?)',
    sha256(token),
    user.id,
    node.id,
    origin,
    expires
  );
  const office = new URL(officeUrl());
  const target = new URL(source);
  target.protocol = office.protocol;
  target.host = office.host;
  const host = (settings.get('collabora.host').trim() || base).replace(/\/+$/, '');
  target.searchParams.set('WOPISrc', `${host}/wopi/files/${node.id}`);
  target.searchParams.set('lang', lang === 'de' ? 'de' : 'en');
  target.searchParams.set('closebutton', 'true');
  if (!write) target.searchParams.set('permission', 'readonly');
  return { url: target.toString(), token, ttl: expires, origin: office.origin, write, name: node.name };
}

export function resolveToken(token: unknown, nodeId: string) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) return null;
  const hash = sha256(token);
  const row = one<{ user_id: number; node_id: string; origin: string; expires_at: number; saved_at: number | null }>(
    'SELECT user_id, node_id, origin, expires_at, saved_at FROM office_tokens WHERE token_hash = ?',
    hash
  );
  if (!row || row.node_id !== nodeId || Number(row.expires_at) <= Date.now()) return null;
  const user = getUser(Number(row.user_id));
  if (!user || inactive(user)) return null;
  const access = resolveAccess(user, nodeId);
  if (!access || access.node.type !== 'file' || access.node.trashed_at) return null;
  return {
    user,
    node: access.node,
    role: access.role,
    origin: row.origin,
    write: writable(user, access.node, access.role),
    hash,
    savedAt: row.saved_at === null ? null : Number(row.saved_at),
  };
}

export const markSaved = (hash: string, now = Date.now()) => run('UPDATE office_tokens SET saved_at = ? WHERE token_hash = ?', now, hash);

export const purgeOfficeTokens = (now = Date.now()) => run('DELETE FROM office_tokens WHERE expires_at <= ?', now).changes;

export const stamp = (node: Pick<NodeRow, 'modified_at'>) => new Date(Number(node.modified_at)).toISOString();
