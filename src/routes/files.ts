import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { rm, stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { z } from 'zod';
import { badRequest, notFound, tooLarge } from '../lib/errors.ts';
import { contentDisposition, PDF_CSP, sendFile } from '../lib/http.ts';
import { t } from '../lib/i18n.ts';
import { inlineType } from '../lib/mime.ts';
import { me } from '../lib/request.ts';
import { id, ids, parse } from '../lib/validate.ts';
import { forNode, forUser, record } from '../services/activity.ts';
import { isZip, listArchive, openEntry } from '../services/archive.ts';
import { extractArchive } from '../services/extract.ts';
import { rotateImage } from '../services/rotate.ts';
import { editImage, OUTPUTS } from '../services/editor.ts';
import { blobPath, getBlob, metaOf, receive, typeOf } from '../services/blobs.ts';
import { addComment, deleteComment, listComments } from '../services/comments.ts';
import { ingest } from '../services/ingest.ts';
import { photos, storageReport } from '../services/library.ts';
import { assertNotInfected } from '../services/scan.ts';
import {
  breadcrumbs,
  copy,
  createFolder,
  destroy,
  emptyTrash,
  move,
  present,
  getNode,
  recent,
  rename,
  renameMany,
  requireAccess,
  requireFolder,
  resolveAccess,
  restore,
  search,
  setStar,
  starred,
  trash,
  trashed,
  children,
  assertSpace,
  setColor,
  FOLDER_COLORS,
  type NodeRow,
} from '../services/nodes.ts';
import { rendition, thumbnail } from '../services/thumbs.ts';
import { createTextFile, formatBytes } from '../services/uploads.ts';
import { deleteVersion, getVersion, listVersions, restoreVersion, writeContent } from '../services/versions.ts';
import { zipName, zipStream } from '../services/zip.ts';
import { storageOf } from '../services/users.ts';
import * as settings from '../services/settings.ts';

type IdParams = { Params: { id: string } };

const nameSchema = z.object({ name: z.string().max(1000) });
const idsSchema = z.object({ ids });
const moveSchema = z.object({ ids, target: id });

export function sendNode(
  request: FastifyRequest,
  reply: FastifyReply,
  node: Pick<NodeRow, 'name' | 'mime' | 'sha256' | 'size' | 'modified_at'>,
  download: boolean
) {
  if (!node.sha256) throw notFound();
  assertNotInfected(node.sha256);
  const type = typeOf(node, getBlob(node.sha256));
  const inline = download ? null : inlineType(node.name, type);
  return sendFile(request, reply, {
    path: blobPath(node.sha256),
    size: node.size,
    type: inline ?? type,
    etag: node.sha256,
    modified: node.modified_at,
    name: node.name,
    disposition: inline ? 'inline' : 'attachment',
    csp: inline === 'application/pdf' ? PDF_CSP : undefined,
  });
}

export async function sendArchiveEntry(reply: FastifyReply, node: NodeRow, path: string) {
  if (!node.sha256 || node.type !== 'file') throw notFound();
  assertNotInfected(node.sha256);
  const entry = await openEntry(blobPath(node.sha256), path, 512 * 1024 * 1024);
  const name = path.split('/').pop() || 'datei';
  reply.header('Content-Type', 'application/octet-stream');
  reply.header('Content-Length', entry.size);
  reply.header('Content-Disposition', contentDisposition(name, 'attachment'));
  reply.header('Content-Security-Policy', "sandbox; default-src 'none'");
  reply.header('Cache-Control', 'private, no-cache');
  reply.header('X-Content-Type-Options', 'nosniff');
  return reply.send(entry.stream);
}

export async function archiveListing(node: NodeRow) {
  if (!node.sha256 || node.type !== 'file') throw notFound();
  assertNotInfected(node.sha256);
  if (!isZip(node)) throw badRequest('Den Inhalt zeigt MoeCloud nur für ZIP-Archive');
  return listArchive(blobPath(node.sha256));
}

export function nodeMeta(node: NodeRow) {
  const blob = node.sha256 ? getBlob(node.sha256) : undefined;
  return {
    width: blob?.width ?? null,
    height: blob?.height ?? null,
    takenAt: blob?.taken_at ?? null,
    meta: metaOf(blob),
    scan: blob?.scan_status ? { status: blob.scan_status, signature: blob.scan_signature, at: blob.scanned_at } : null,
    processed: blob ? blob.processed !== 0 : true,
  };
}

export async function sendThumb(request: FastifyRequest, reply: FastifyReply, node: NodeRow) {
  const path = await thumbnail(node);
  if (!path || !node.sha256) throw notFound('Für diese Datei gibt es keine Vorschau');
  const info = await stat(path);
  return sendFile(request, reply, {
    path,
    size: info.size,
    type: 'image/webp',
    etag: `t-${node.sha256}`,
    modified: node.modified_at,
    name: `${node.name}.webp`,
    disposition: 'inline',
    cache: 'private, max-age=31536000, immutable',
  });
}

export async function sendPreview(request: FastifyRequest, reply: FastifyReply, node: NodeRow) {
  const path = await rendition(node);
  if (!path || !node.sha256) throw notFound('Für diese Datei gibt es keine Vorschau');
  const info = await stat(path);
  return sendFile(request, reply, {
    path,
    size: info.size,
    type: 'image/webp',
    etag: `p-${node.sha256}`,
    modified: node.modified_at,
    name: `${node.name}.webp`,
    disposition: 'inline',
    cache: 'private, max-age=31536000, immutable',
  });
}

export function sendZip(request: FastifyRequest, reply: FastifyReply, roots: NodeRow[], fixed?: string) {
  const name = fixed ?? zipName(roots, t(request.lang, 'Dateien'));
  reply.header('Content-Type', 'application/zip');
  reply.header('Content-Disposition', contentDisposition(name, 'attachment'));
  reply.header('Cache-Control', 'no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  return reply.send(zipStream(roots));
}

export async function fileRoutes(app: FastifyInstance) {
  app.get<IdParams>('/api/nodes/:id', async (request) => {
    const user = me(request);
    const access = requireAccess(user, request.params.id);
    return { node: present([access.node], user, access.role)[0], breadcrumbs: breadcrumbs(access), role: access.role };
  });

  app.get<IdParams & { Querystring: { folders?: string } }>('/api/nodes/:id/children', async (request) => {
    const user = me(request);
    const access = requireFolder(user, request.params.id);
    return {
      folder: present([access.node], user, access.role)[0],
      breadcrumbs: breadcrumbs(access),
      role: access.role,
      shared: access.role !== 'owner' ? { rootId: access.rootId } : null,
      items: present(children(access.node.id, request.query.folders === '1'), user, access.role),
    };
  });

  app.post<IdParams>('/api/nodes/:id/folders', async (request) => {
    const user = me(request);
    const { name } = parse(nameSchema, request.body);
    const node = createFolder(user, request.params.id, name);
    return { node: present([node], user, requireAccess(user, node.id).role)[0] };
  });

  app.post<IdParams>('/api/nodes/:id/text', async (request) => {
    const user = me(request);
    const input = parse(z.object({ name: z.string().max(1000), content: z.string().max(5_000_000).optional() }), request.body);
    const node = await createTextFile(user, request.params.id, input.name, input.content ?? '');
    return { node: present([node], user, requireAccess(user, node.id).role)[0] };
  });

  app.patch<IdParams>('/api/nodes/:id', async (request) => {
    const user = me(request);
    const { name } = parse(nameSchema, request.body);
    const node = rename(user, request.params.id, name);
    return { node: present([node], user, requireAccess(user, node.id).role)[0] };
  });

  app.post('/api/nodes/rename', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({
        items: z
          .array(z.object({ id, name: z.string().max(1000) }))
          .min(1, 'Wähle mindestens ein Element aus')
          .max(1000, 'Höchstens 1000 Elemente auf einmal'),
      }),
      request.body
    );
    return { items: present(renameMany(user, input.items), user) };
  });

  app.post('/api/nodes/move', async (request) => {
    const user = me(request);
    const input = parse(moveSchema, request.body);
    return { items: present(move(user, input.ids, input.target), user) };
  });

  app.post('/api/nodes/copy', async (request) => {
    const user = me(request);
    const input = parse(moveSchema, request.body);
    return { items: present(copy(user, input.ids, input.target), user) };
  });

  app.post('/api/nodes/trash', async (request) => {
    trash(me(request), parse(idsSchema, request.body).ids);
    return { ok: true };
  });

  app.post('/api/nodes/restore', async (request) => {
    const user = me(request);
    return { items: present(restore(user, parse(idsSchema, request.body).ids), user) };
  });

  app.post('/api/nodes/delete', async (request) => {
    destroy(me(request), parse(idsSchema, request.body).ids);
    return { ok: true };
  });

  app.delete('/api/trash', async (request) => ({ removed: emptyTrash(me(request)) }));

  app.put<IdParams>('/api/nodes/:id/star', async (request) => {
    const { starred: value } = parse(z.object({ starred: z.boolean() }), request.body);
    setStar(me(request), request.params.id, value);
    return { starred: value };
  });

  app.get('/api/recent', async (request) => {
    const user = me(request);
    return { items: present(recent(user), user) };
  });

  app.get('/api/starred', async (request) => {
    const user = me(request);
    return { items: present(starred(user), user, (node) => resolveAccess(user, node.id)?.role ?? 'view') };
  });

  app.get('/api/trash', async (request) => {
    const user = me(request);
    return { items: present(trashed(user), user), days: settings.get('storage.trashDays') };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/search', async (request) => {
    const user = me(request);
    const query = request.query;
    const number = (value: string | undefined) => {
      const parsed = Number(value);
      return value !== undefined && value !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    };
    const filters = {
      kind: query.kind || undefined,
      after: number(query.after),
      before: number(query.before),
      minSize: number(query.minSize),
      maxSize: number(query.maxSize),
      tag: query.tag && /^[0-9A-Za-z]{8,40}$/.test(query.tag) ? query.tag : undefined,
    };
    return { items: present(search(user, String(query.q ?? ''), filters), user) };
  });

  app.get('/api/storage', async (request) => storageOf(me(request)));

  app.get<IdParams & { Querystring: { download?: string } }>('/api/nodes/:id/content', { compress: false }, async (request, reply) => {
    const { node } = requireAccess(me(request), request.params.id);
    if (node.type !== 'file') throw badRequest('Ordner lädst du als ZIP herunter');
    return sendNode(request, reply, node, request.query.download === '1');
  });

  app.put<IdParams>('/api/nodes/:id/content', async (request) => {
    const user = me(request);
    const { node } = requireAccess(user, request.params.id, 'edit');
    if (node.type !== 'file') throw badRequest('In einen Ordner kannst du nicht schreiben');
    const max = settings.get('storage.maxUpload');
    const stream = request.body as Readable | undefined;
    if (!stream || typeof (stream as Readable).pipe !== 'function') throw badRequest('Der Inhalt fehlt');
    const received = await receive(stream, max > 0 ? max : Number.MAX_SAFE_INTEGER, () =>
      tooLarge('Dateien dürfen höchstens {size} groß sein', { size: formatBytes(max) })
    );
    try {
      assertSpace(node.owner_id, received.size - node.size, user.id);
    } catch (error) {
      await rm(received.path, { force: true });
      throw error;
    }
    await ingest(received, { userId: user.id, name: node.name, via: 'editor' });
    const updated = writeContent(node, { sha256: received.sha256, size: received.size }, user.id);
    record({ owner: node.owner_id, actor: user.id, node: node.id, parent: node.parent_id, action: 'edit', name: node.name });
    return { node: present([updated], user, requireAccess(user, updated.id).role)[0] };
  });

  app.post<IdParams>('/api/nodes/:id/rotate', async (request) => {
    const user = me(request);
    const input = parse(z.object({ degrees: z.union([z.literal(90), z.literal(180), z.literal(270)]) }), request.body);
    const { node } = requireAccess(user, request.params.id, 'edit');
    const updated = await rotateImage(user, node, input.degrees);
    return { node: present([updated], user, requireAccess(user, updated.id).role)[0] };
  });

  app.post<IdParams>('/api/nodes/:id/edit', async (request) => {
    const user = me(request);
    const unit = z.number().min(0).max(1);
    const input = parse(
      z.object({
        rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
        flipH: z.boolean().default(false),
        flipV: z.boolean().default(false),
        crop: z
          .object({ x: unit, y: unit, width: unit.gt(0), height: unit.gt(0) })
          .nullable()
          .default(null),
        maxEdge: z.number().int().min(16).max(16_384).nullable().default(null),
        format: z.enum(['original', ...OUTPUTS]).default('original'),
        quality: z.number().int().min(1).max(100).default(90),
        save: z.enum(['version', 'copy']).default('copy'),
      }),
      request.body
    );
    const node = await editImage(user, request.params.id, input, t(request.lang, '{name} (bearbeitet)'));
    return { node: present([node], user, (entry) => resolveAccess(user, entry.id)?.role ?? 'view')[0] };
  });

  app.get<IdParams>('/api/nodes/:id/thumb', { compress: false }, async (request, reply) => {
    const { node } = requireAccess(me(request), request.params.id);
    return sendThumb(request, reply, node);
  });

  app.get<IdParams>('/api/nodes/:id/preview', { compress: false }, async (request, reply) => {
    const { node } = requireAccess(me(request), request.params.id);
    return sendPreview(request, reply, node);
  });

  app.get<IdParams>('/api/nodes/:id/versions', async (request) => ({ items: listVersions(me(request), request.params.id) }));

  app.get<{ Params: { id: string; version: string }; Querystring: { download?: string } }>(
    '/api/nodes/:id/versions/:version/content',
    { compress: false },
    async (request, reply) => {
      const { access, version } = getVersion(me(request), request.params.id, request.params.version);
      return sendNode(
        request,
        reply,
        { name: access.node.name, mime: version.mime, sha256: version.sha256, size: version.size, modified_at: version.modified_at },
        true
      );
    }
  );

  app.post<{ Params: { id: string; version: string } }>('/api/nodes/:id/versions/:version/restore', async (request) => {
    const user = me(request);
    const node = restoreVersion(user, request.params.id, request.params.version);
    return { node: present([node], user, requireAccess(user, node.id).role)[0] };
  });

  app.delete<{ Params: { id: string; version: string } }>('/api/nodes/:id/versions/:version', async (request) => {
    deleteVersion(me(request), request.params.id, request.params.version);
    return { ok: true };
  });

  app.put('/api/nodes/color', async (request) => {
    const input = parse(z.object({ ids, color: z.enum(FOLDER_COLORS).nullable() }), request.body);
    setColor(me(request), input.ids, input.color);
    return { ok: true };
  });

  app.get<IdParams>('/api/nodes/:id/activity', async (request) => {
    const user = me(request);
    const access = requireAccess(user, request.params.id);
    return { items: forNode(access.node.id, user.id, access.role, (nodeId) => Boolean(resolveAccess(user, nodeId))) };
  });

  app.get<{ Querystring: { before?: string } }>('/api/activity', async (request) => {
    const before = Number(request.query.before);
    return forUser(me(request).id, Number.isSafeInteger(before) && before > 0 ? before : undefined);
  });

  app.get<IdParams>('/api/nodes/:id/comments', async (request) => ({ items: listComments(me(request), request.params.id) }));

  app.post<IdParams>('/api/nodes/:id/comments', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
    const { text } = parse(z.object({ text: z.string().max(5000) }), request.body);
    return { comment: addComment(me(request), request.params.id, text) };
  });

  app.delete<{ Params: { id: string; comment: string } }>('/api/nodes/:id/comments/:comment', async (request) => {
    deleteComment(me(request), request.params.id, request.params.comment);
    return { ok: true };
  });

  app.get<IdParams>('/api/nodes/:id/meta', async (request) => {
    const { node } = requireAccess(me(request), request.params.id);
    return nodeMeta(node);
  });

  app.post<IdParams>('/api/nodes/:id/extract', async (request) => {
    const user = me(request);
    const result = await extractArchive(user, request.params.id);
    return { ...result, folder: present([getNode(result.folderId)!], user)[0] };
  });

  app.get<IdParams>('/api/nodes/:id/archive', async (request) => {
    const { node } = requireAccess(me(request), request.params.id);
    return archiveListing(node);
  });

  app.get<IdParams & { Querystring: { path?: string } }>('/api/nodes/:id/archive/entry', { compress: false }, async (request, reply) => {
    const { node } = requireAccess(me(request), request.params.id);
    return sendArchiveEntry(reply, node, String(request.query.path ?? ''));
  });

  app.get<{ Querystring: { at?: string; seq?: string } }>('/api/photos', async (request) => {
    const user = me(request);
    const at = Number(request.query.at);
    const seq = Number(request.query.seq);
    const page = photos(user, Number.isFinite(at) && Number.isFinite(seq) && request.query.at ? { at, seq } : null);
    return { items: present(page.nodes, user), next: page.next };
  });

  app.get('/api/storage/report', async (request) => {
    const user = me(request);
    const report = storageReport(user);
    return {
      used: report.used,
      quota: report.quota,
      trash: report.trash,
      versions: report.versions,
      groups: report.groups,
      largest: present(report.largest, user),
      duplicates: report.duplicates.map((group) => ({
        sha256: group.sha256.slice(0, 12),
        size: group.size,
        wasted: group.wasted,
        items: present(group.nodes, user),
      })),
    };
  });

  app.get<{ Querystring: { ids?: string } }>('/api/zip', { compress: false }, async (request, reply) => {
    const user = me(request);
    const list = String(request.query.ids ?? '')
      .split(',')
      .filter(Boolean);
    const roots = parse(ids, list).map((nodeId) => requireAccess(user, nodeId).node);
    return sendZip(request, reply, roots);
  });
}
