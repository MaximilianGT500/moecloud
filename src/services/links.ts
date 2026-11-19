import type { FastifyRequest } from 'fastify';
import { all, one, run } from '../lib/db.ts';
import { hashPassword, hmac, randomId, safeEqual } from '../lib/crypto.ts';
import { deviceOf } from '../lib/agent.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import type { Lang } from '../lib/i18n.ts';
import { record } from './activity.ts';
import { chain, getNode, requireAccess, resolveAccess, type NodeRow } from './nodes.ts';
import { notify } from './notify.ts';
import * as settings from './settings.ts';
import { getUser, type UserRow } from './users.ts';

export interface LinkRow {
  id: string;
  token: string;
  node_id: string;
  owner_id: number;
  created_by: number;
  label: string | null;
  password_hash: string | null;
  expires_at: number | null;
  allow_download: number;
  allow_upload: number;
  upload_only: number;
  views: number;
  downloads: number;
  created_at: number;
  last_access_at: number | null;
  notify: number;
  max_downloads: number | null;
  paused: number;
  notify_downloads: number;
  notified_at: number | null;
  slug: string | null;
  warned_at: number | null;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const WARN_BEFORE = 48 * 60 * 60 * 1000;
const WARN_MIN_LIFE = 4 * 24 * 60 * 60 * 1000;
const EVENTS_PER_LINK = 1000;

export type LinkEventKind = 'view' | 'download' | 'upload' | 'denied';

const DOWNLOAD_NOTICE_GAP = 60 * 60 * 1000;

export interface LinkInput {
  label?: string | null;
  password?: string | null;
  expiresAt?: number | null;
  allowDownload?: boolean;
  allowUpload?: boolean;
  uploadOnly?: boolean;
  notify?: boolean;
  notifyDownloads?: boolean;
  maxDownloads?: number | null;
  paused?: boolean;
  slug?: string | null;
}

export const getLink = (id: string) => one<LinkRow>('SELECT * FROM links WHERE id = ?', id);

export const exhausted = (link: LinkRow) => Boolean(link.max_downloads && link.downloads >= link.max_downloads);

export function linkState(link: LinkRow): 'active' | 'expired' | 'paused' | 'exhausted' {
  if (link.expires_at && link.expires_at <= Date.now()) return 'expired';
  if (link.paused) return 'paused';
  if (exhausted(link)) return 'exhausted';
  return 'active';
}

export function linkByToken(token: string) {
  const exact = /^[0-9A-Za-z]{10,40}$/.test(token) ? one<LinkRow>('SELECT * FROM links WHERE token = ?', token) : undefined;
  if (exact) return exact;
  const slug = token.toLowerCase();
  return SLUG.test(slug) ? one<LinkRow>('SELECT * FROM links WHERE slug = ?', slug) : undefined;
}

function slugFor(input: string | null | undefined, current: LinkRow | null) {
  if (input === undefined) return current?.slug ?? null;
  const slug = (input ?? '').trim().toLowerCase();
  if (!slug) return null;
  if (slug === current?.slug) return slug;
  if (!settings.get('share.slugs')) throw forbidden('Eigene Adressen für Links sind auf diesem Server ausgeschaltet');
  if (!SLUG.test(slug)) {
    throw badRequest('Die Adresse braucht 3 bis 64 Zeichen aus Kleinbuchstaben, Ziffern und Bindestrichen, ohne Bindestrich am Rand');
  }
  if (one('SELECT 1 AS found FROM links WHERE (slug = ? OR LOWER(token) = ?) AND id != ?', slug, slug, current?.id ?? '')) {
    throw conflict('Diese Adresse ist schon vergeben');
  }
  return slug;
}

export function logLinkEvent(link: LinkRow, kind: LinkEventKind, name?: string | null, agent?: string | null) {
  run(
    'INSERT INTO link_events (id, link_id, kind, name, agent, at) VALUES (?, ?, ?, ?, ?, ?)',
    randomId(),
    link.id,
    kind,
    name?.slice(0, 255) ?? null,
    agent?.slice(0, 300) ?? null,
    Date.now()
  );
}

export function linkEvents(user: UserRow, id: string, lang: Lang) {
  const link = ownLink(user, id);
  return all<{ kind: LinkEventKind; name: string | null; agent: string | null; at: number }>(
    'SELECT kind, name, agent, at FROM link_events WHERE link_id = ? ORDER BY at DESC, id DESC LIMIT 200',
    link.id
  ).map((row) => ({ kind: row.kind, name: row.name, device: row.agent ? deviceOf(lang, row.agent) : null, at: Number(row.at) }));
}

export function purgeLinkEvents(days: number, now = Date.now()) {
  let removed = days > 0 ? run('DELETE FROM link_events WHERE at < ?', now - days * 86_400_000).changes : 0;
  removed += run(
    `DELETE FROM link_events WHERE id IN (
       SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY link_id ORDER BY at DESC, id DESC) AS position FROM link_events) ranked
       WHERE position > ?
     )`,
    EVENTS_PER_LINK
  ).changes;
  return removed;
}

export function warnExpiringLinks(now = Date.now()) {
  const soon = all<LinkRow>(
    `SELECT * FROM links WHERE expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ? AND warned_at IS NULL AND paused = 0
       AND expires_at - created_at >= ?`,
    now,
    now + WARN_BEFORE,
    WARN_MIN_LIFE
  );
  let warned = 0;
  for (const link of soon) {
    run('UPDATE links SET warned_at = ? WHERE id = ?', now, link.id);
    const node = getNode(link.node_id);
    const creator = getUser(link.created_by);
    if (!node || node.trashed_at || !creator || exhausted(link)) continue;
    const url =
      node.type === 'folder'
        ? `/files/folder/${node.id}`
        : node.parent_id && resolveAccess(creator, node.parent_id)
          ? `/files/folder/${node.parent_id}?select=${node.id}`
          : '/files/shared';
    notify(creator.id, 'link_expiring', { name: link.label || node.name, date: Number(link.expires_at) }, url);
    warned += 1;
  }
  return warned;
}

export function resolveToken(token: string) {
  const link = linkByToken(token);
  if (!link || linkState(link) !== 'active') return null;
  const node = getNode(link.node_id);
  if (!node || node.trashed_at) return null;
  return { link, node };
}

export function linkNode(link: LinkRow, nodeId: string): NodeRow {
  const node = getNode(nodeId);
  if (!node || node.trashed_at) throw notFound();
  if (node.id !== link.node_id) {
    if (link.upload_only) throw notFound();
    if (!chain(node.id).some((entry) => entry.id === link.node_id)) throw notFound();
  }
  return node;
}

export function linkFolder(link: LinkRow, folderId: string, forUpload = false): NodeRow {
  const node = linkNode(link, folderId);
  if (node.type !== 'folder') throw badRequest('Das ist kein Ordner');
  if (forUpload && !link.allow_upload) throw forbidden('Über diesen Link kannst du nichts hochladen');
  return node;
}

export const unlockCookie = (link: LinkRow) => `moe_l_${link.id}`;
const unlockValue = (link: LinkRow) => hmac(settings.secret(), `${link.id}:${link.password_hash ?? ''}`);
export const unlockToken = unlockValue;

export function isUnlocked(request: FastifyRequest, link: LinkRow) {
  if (!link.password_hash) return true;
  return safeEqual(request.cookies?.[unlockCookie(link)], unlockValue(link));
}

function expiry(input: number | null | undefined) {
  const maxDays = settings.get('share.maxDays');
  const limit = maxDays > 0 ? Date.now() + maxDays * 86_400_000 : null;
  if (input === undefined || input === null) return limit;
  if (input <= Date.now()) throw badRequest('Das Ablaufdatum muss in der Zukunft liegen');
  return limit ? Math.min(input, limit) : input;
}

function canManage(user: UserRow, link: LinkRow) {
  return link.created_by === user.id || link.owner_id === user.id || user.role === 'admin';
}

function ownLink(user: UserRow, id: string) {
  const link = getLink(id);
  if (!link || !canManage(user, link)) throw notFound('Diesen Link gibt es nicht mehr');
  return link;
}

export function activeLink(user: UserRow, id: string) {
  const link = ownLink(user, id);
  const node = getNode(link.node_id);
  if (!node || node.trashed_at) throw notFound('Diesen Link gibt es nicht mehr');
  const state = linkState(link);
  if (state === 'expired') throw badRequest('Dieser Link ist abgelaufen oder wurde gelöscht');
  if (state === 'paused') throw badRequest('Dieser Link ist gerade pausiert');
  if (state === 'exhausted') throw badRequest('Dieser Link wurde schon so oft genutzt wie erlaubt');
  return { link, node };
}

export async function createLink(user: UserRow, nodeId: string, input: LinkInput) {
  if (!settings.get('share.links')) throw forbidden('Öffentliche Links sind auf diesem Server ausgeschaltet');
  if (user.role === 'guest') throw forbidden('Mit einem Gastkonto kannst du nichts weiterteilen');
  const { node } = requireAccess(user, nodeId, 'edit');
  if (!node.parent_id) throw badRequest('Den Hauptordner kannst du nicht teilen');
  const password = input.password?.trim() ? input.password : null;
  if (settings.get('share.requirePassword') && !password) throw badRequest('Links brauchen auf diesem Server ein Passwort');
  const folder = node.type === 'folder';
  const id = randomId(16);
  const uploads = folder && Boolean(input.allowUpload || input.uploadOnly);
  const slug = slugFor(input.slug, null);
  run(
    `INSERT INTO links (id, token, node_id, owner_id, created_by, label, password_hash, expires_at, allow_download, allow_upload, upload_only, notify, max_downloads, notify_downloads, slug, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    randomId(22),
    node.id,
    node.owner_id,
    user.id,
    input.label?.trim() || null,
    password ? await hashPassword(password) : null,
    expiry(input.expiresAt),
    input.allowDownload ?? true,
    uploads,
    folder && Boolean(input.uploadOnly),
    uploads && (input.notify ?? true),
    input.maxDownloads ?? null,
    (input.allowDownload ?? true) && !(folder && input.uploadOnly) && Boolean(input.notifyDownloads),
    slug,
    Date.now()
  );
  record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'share_link', name: node.name });
  return getLink(id)!;
}

export async function updateLink(user: UserRow, id: string, input: LinkInput & { removePassword?: boolean }) {
  const link = ownLink(user, id);
  const node = getNode(link.node_id);
  const folder = node?.type === 'folder';
  let passwordHash = link.password_hash;
  if (input.removePassword) passwordHash = null;
  if (input.password?.trim()) passwordHash = await hashPassword(input.password);
  if (settings.get('share.requirePassword') && !passwordHash) throw badRequest('Links brauchen auf diesem Server ein Passwort');
  const uploadOnly = folder && (input.uploadOnly ?? Boolean(link.upload_only));
  const uploads = folder && (uploadOnly || (input.allowUpload ?? Boolean(link.allow_upload)));
  const downloads = (input.allowDownload ?? Boolean(link.allow_download)) && !uploadOnly;
  const expiresAt = input.expiresAt === undefined ? link.expires_at : expiry(input.expiresAt);
  run(
    `UPDATE links SET label = ?, password_hash = ?, expires_at = ?, allow_download = ?, allow_upload = ?, upload_only = ?, notify = ?, max_downloads = ?, paused = ?, notify_downloads = ?, slug = ?, warned_at = ? WHERE id = ?`,
    input.label === undefined ? link.label : input.label?.trim() || null,
    passwordHash,
    expiresAt,
    input.allowDownload ?? Boolean(link.allow_download),
    uploads,
    uploadOnly,
    uploads && (input.notify ?? Boolean(link.notify)),
    input.maxDownloads === undefined ? link.max_downloads : input.maxDownloads,
    input.paused === undefined ? link.paused : input.paused,
    downloads && (input.notifyDownloads ?? Boolean(link.notify_downloads)),
    slugFor(input.slug, link),
    expiresAt === link.expires_at ? link.warned_at : null,
    id
  );
  return getLink(id)!;
}

export function deleteLink(user: UserRow, id: string) {
  const link = ownLink(user, id);
  run('DELETE FROM links WHERE id = ?', id);
  return link;
}

export const linksForNode = (nodeId: string) => all<LinkRow>('SELECT * FROM links WHERE node_id = ? ORDER BY created_at DESC', nodeId);

export const linksBy = (user: UserRow) =>
  all<LinkRow>('SELECT * FROM links WHERE created_by = ? OR owner_id = ? ORDER BY created_at DESC', user.id, user.id);

export function countAccess(link: LinkRow, kind: 'views' | 'downloads', name?: string, agent?: string | null) {
  if (kind === 'views') {
    run('UPDATE links SET views = views + 1, last_access_at = ? WHERE id = ?', Date.now(), link.id);
    logLinkEvent(link, 'view', null, agent);
    return;
  }
  const { changes } = run(
    'UPDATE links SET downloads = downloads + 1, last_access_at = ? WHERE id = ? AND (max_downloads IS NULL OR downloads < max_downloads)',
    Date.now(),
    link.id
  );
  if (changes === 0) throw notFound('Dieser Link wurde schon so oft genutzt wie erlaubt');
  logLinkEvent(link, 'download', name ?? null, agent);
  if (link.notify_downloads) noticeDownload(link, name);
}

function noticeDownload(link: LinkRow, name?: string) {
  const now = Date.now();
  const claimed = run(
    'UPDATE links SET notified_at = ? WHERE id = ? AND (notified_at IS NULL OR notified_at <= ?)',
    now,
    link.id,
    now - DOWNLOAD_NOTICE_GAP
  ).changes;
  const node = claimed ? getNode(link.node_id) : undefined;
  const creator = node ? getUser(link.created_by) : undefined;
  if (!node || !creator) return;
  const url =
    node.type === 'folder'
      ? `/files/folder/${node.id}`
      : node.parent_id && resolveAccess(creator, node.parent_id)
        ? `/files/folder/${node.parent_id}?select=${node.id}`
        : '/files/shared';
  notify(creator.id, 'link_download', { name: name ?? node.name, count: Number(link.downloads) + 1 }, url);
}

export const downloadsLeft = (link: LinkRow) => (link.max_downloads ? Math.max(0, link.max_downloads - link.downloads) : null);

export function baseUrl(request: FastifyRequest) {
  const configured = settings.get('site.url').replace(/\/+$/, '');
  return configured || `${request.protocol}://${request.host}`;
}

export function presentLink(link: LinkRow, request: FastifyRequest) {
  return {
    id: link.id,
    token: link.token,
    slug: link.slug,
    url: `${baseUrl(request)}/s/${link.slug ?? link.token}`,
    nodeId: link.node_id,
    label: link.label,
    hasPassword: Boolean(link.password_hash),
    expiresAt: link.expires_at,
    expired: Boolean(link.expires_at && link.expires_at <= Date.now()),
    allowDownload: Boolean(link.allow_download),
    allowUpload: Boolean(link.allow_upload),
    uploadOnly: Boolean(link.upload_only),
    notify: Boolean(link.notify),
    notifyDownloads: Boolean(link.notify_downloads),
    views: link.views,
    downloads: link.downloads,
    maxDownloads: link.max_downloads,
    paused: Boolean(link.paused),
    exhausted: exhausted(link),
    createdAt: link.created_at,
    lastAccessAt: link.last_access_at,
  };
}

export const allLinks = () => all<LinkRow>('SELECT * FROM links ORDER BY created_at DESC LIMIT 500');

export function adminDeleteLink(id: string) {
  const link = getLink(id);
  if (!link) throw notFound('Diesen Link gibt es nicht mehr');
  run('DELETE FROM links WHERE id = ?', id);
  return link;
}
