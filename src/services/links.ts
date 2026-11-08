import type { FastifyRequest } from 'fastify';
import { all, one, run } from '../lib/db.ts';
import { hashPassword, hmac, randomId, safeEqual } from '../lib/crypto.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { record } from './activity.ts';
import { chain, getNode, requireAccess, type NodeRow } from './nodes.ts';
import * as settings from './settings.ts';
import type { UserRow } from './users.ts';

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
}

export interface LinkInput {
  label?: string | null;
  password?: string | null;
  expiresAt?: number | null;
  allowDownload?: boolean;
  allowUpload?: boolean;
  uploadOnly?: boolean;
  notify?: boolean;
}

export const getLink = (id: string) => one<LinkRow>('SELECT * FROM links WHERE id = ?', id);

export function resolveToken(token: string) {
  if (!/^[0-9A-Za-z]{10,40}$/.test(token)) return null;
  const link = one<LinkRow>('SELECT * FROM links WHERE token = ?', token);
  if (!link || (link.expires_at && link.expires_at <= Date.now())) return null;
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

export async function createLink(user: UserRow, nodeId: string, input: LinkInput) {
  if (!settings.get('share.links')) throw forbidden('Öffentliche Links sind auf diesem Server ausgeschaltet');
  const { node } = requireAccess(user, nodeId, 'edit');
  if (!node.parent_id) throw badRequest('Den Hauptordner kannst du nicht teilen');
  const password = input.password?.trim() ? input.password : null;
  if (settings.get('share.requirePassword') && !password) throw badRequest('Links brauchen auf diesem Server ein Passwort');
  const folder = node.type === 'folder';
  const id = randomId(16);
  const uploads = folder && Boolean(input.allowUpload || input.uploadOnly);
  run(
    `INSERT INTO links (id, token, node_id, owner_id, created_by, label, password_hash, expires_at, allow_download, allow_upload, upload_only, notify, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    Date.now()
  );
  record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'share_link', name: node.name });
  return getLink(id)!;
}

export async function updateLink(user: UserRow, id: string, input: LinkInput & { removePassword?: boolean }) {
  const link = getLink(id);
  if (!link || !canManage(user, link)) throw notFound('Diesen Link gibt es nicht mehr');
  const node = getNode(link.node_id);
  const folder = node?.type === 'folder';
  let passwordHash = link.password_hash;
  if (input.removePassword) passwordHash = null;
  if (input.password?.trim()) passwordHash = await hashPassword(input.password);
  if (settings.get('share.requirePassword') && !passwordHash) throw badRequest('Links brauchen auf diesem Server ein Passwort');
  const uploadOnly = folder && (input.uploadOnly ?? Boolean(link.upload_only));
  const uploads = folder && (uploadOnly || (input.allowUpload ?? Boolean(link.allow_upload)));
  run(
    `UPDATE links SET label = ?, password_hash = ?, expires_at = ?, allow_download = ?, allow_upload = ?, upload_only = ?, notify = ? WHERE id = ?`,
    input.label === undefined ? link.label : input.label?.trim() || null,
    passwordHash,
    input.expiresAt === undefined ? link.expires_at : expiry(input.expiresAt),
    input.allowDownload ?? Boolean(link.allow_download),
    uploads,
    uploadOnly,
    uploads && (input.notify ?? Boolean(link.notify)),
    id
  );
  return getLink(id)!;
}

export function deleteLink(user: UserRow, id: string) {
  const link = getLink(id);
  if (!link || !canManage(user, link)) throw notFound('Diesen Link gibt es nicht mehr');
  run('DELETE FROM links WHERE id = ?', id);
  return link;
}

export const linksForNode = (nodeId: string) => all<LinkRow>('SELECT * FROM links WHERE node_id = ? ORDER BY created_at DESC', nodeId);

export const linksBy = (user: UserRow) =>
  all<LinkRow>('SELECT * FROM links WHERE created_by = ? OR owner_id = ? ORDER BY created_at DESC', user.id, user.id);

export function countAccess(link: LinkRow, kind: 'views' | 'downloads') {
  run(
    `UPDATE links SET ${kind === 'views' ? 'views = views + 1' : 'downloads = downloads + 1'}, last_access_at = ? WHERE id = ?`,
    Date.now(),
    link.id
  );
}

export function baseUrl(request: FastifyRequest) {
  const configured = settings.get('site.url').replace(/\/+$/, '');
  return configured || `${request.protocol}://${request.host}`;
}

export function presentLink(link: LinkRow, request: FastifyRequest) {
  return {
    id: link.id,
    token: link.token,
    url: `${baseUrl(request)}/s/${link.token}`,
    nodeId: link.node_id,
    label: link.label,
    hasPassword: Boolean(link.password_hash),
    expiresAt: link.expires_at,
    expired: Boolean(link.expires_at && link.expires_at <= Date.now()),
    allowDownload: Boolean(link.allow_download),
    allowUpload: Boolean(link.allow_upload),
    uploadOnly: Boolean(link.upload_only),
    notify: Boolean(link.notify),
    views: link.views,
    downloads: link.downloads,
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
