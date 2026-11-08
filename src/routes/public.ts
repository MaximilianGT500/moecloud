import type { FastifyInstance, FastifyRequest } from 'fastify';
import { forbidden, HttpError, notFound, unauthorized } from '../lib/errors.ts';
import { verifyPassword } from '../lib/crypto.ts';
import { escapeHtml, isSecure } from '../lib/http.ts';
import { renderApp, renderDocument } from '../lib/html.ts';
import { t } from '../lib/i18n.ts';
import { checkFormCsrf, body } from '../lib/request.ts';
import { Limiter } from '../lib/limiter.ts';
import { kindOf } from '../lib/mime.ts';
import { parse, ids } from '../lib/validate.ts';
import { messagePage, sharePasswordPage } from '../views/pages.ts';
import { blobInfo, chain, children, type NodeRow } from '../services/nodes.ts';
import { hasPreview } from '../services/thumbs.ts';
import {
  baseUrl,
  countAccess,
  isUnlocked,
  linkFolder,
  linkNode,
  resolveToken,
  unlockCookie,
  unlockToken,
  type LinkRow,
} from '../services/links.ts';
import * as settings from '../services/settings.ts';
import { getUser } from '../services/users.ts';
import { archiveListing, nodeMeta, sendArchiveEntry, sendNode, sendThumb, sendZip } from './files.ts';
import { uploadEndpoints } from './uploads.ts';
import { value } from '../lib/db.ts';

type TokenParams = { Params: { token: string } };

const unlockAttempts = new Limiter(20, 15 * 60 * 1000);

export function presentPublic(nodes: NodeRow[]) {
  const blobs = blobInfo(nodes.filter((node) => node.sha256).map((node) => node.sha256!));
  return nodes.map((node) => {
    const blob = node.sha256 ? blobs.get(node.sha256) : undefined;
    return {
      id: node.id,
      parentId: node.parent_id,
      type: node.type,
      name: node.name,
      kind: kindOf(node.name, node.mime, node.type),
      mime: node.mime,
      size: node.size,
      items:
        node.type === 'folder'
          ? (value<number>('SELECT COUNT(*) FROM nodes WHERE parent_id = ? AND trashed_at IS NULL', node.id) ?? 0)
          : null,
      modifiedAt: node.modified_at,
      version: `${node.etag}${node.sha256 ? `-${node.sha256.slice(0, 12)}` : ''}`,
      thumb: hasPreview(node, blob),
      color: node.type === 'folder' ? node.color : null,
      infected: blob?.scan_status === 'infected',
      takenAt: blob?.taken_at ?? null,
      width: blob?.width ?? null,
      height: blob?.height ?? null,
    };
  });
}

function linkFor(request: FastifyRequest<TokenParams>) {
  const resolved = resolveToken(request.params.token);
  if (!resolved) throw notFound('Dieser Link ist abgelaufen oder wurde gelöscht');
  if (!isUnlocked(request, resolved.link)) throw unauthorized('Dieser Link ist mit einem Passwort geschützt');
  return resolved;
}

function publicCrumbs(link: LinkRow, node: NodeRow) {
  const nodes = chain(node.id);
  const start = Math.max(
    0,
    nodes.findIndex((entry) => entry.id === link.node_id)
  );
  return nodes.slice(start).map((entry) => ({ id: entry.id, name: entry.name }));
}

function invalidPage(request: FastifyRequest) {
  return messagePage(request, {
    icon: 'linkOff',
    title: t(request.lang, 'Dieser Link funktioniert nicht mehr'),
    text: t(request.lang, 'Er ist abgelaufen oder wurde gelöscht. Frag die Person, die ihn dir geschickt hat, nach einem neuen.'),
    action: null,
  });
}

export async function publicRoutes(app: FastifyInstance) {
  app.get<TokenParams>('/s/:token', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const resolved = resolveToken(request.params.token);
    if (!resolved) {
      return renderDocument(request, reply, { title: t(request.lang, 'Link ungültig'), status: 404, body: invalidPage(request) });
    }
    const { link, node } = resolved;
    if (!isUnlocked(request, link)) {
      return renderDocument(request, reply, {
        title: t(request.lang, 'Geschützter Link'),
        body: sharePasswordPage(request, { csrf: request.csrf, name: node.name }),
      });
    }
    countAccess(link, 'views');
    const owner = getUser(link.owner_id);
    const site = settings.get('site.name');
    const url = `${baseUrl(request)}/s/${link.token}`;
    const image = !link.password_hash && !link.upload_only && presentPublic([node])[0].thumb;
    const description = t(request.lang, 'Geteilt von {name} über {site}', { name: owner?.name ?? '', site });
    const extraHead = [
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="${escapeHtml(site)}">`,
      `<meta property="og:title" content="${escapeHtml(link.label || node.name)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${escapeHtml(url)}">`,
      image ? `<meta property="og:image" content="${escapeHtml(`${url}/thumb`)}">` : '',
      image ? '<meta name="twitter:card" content="summary_large_image">' : '<meta name="twitter:card" content="summary">',
      '<meta name="referrer" content="no-referrer">',
    ]
      .filter(Boolean)
      .join('\n');
    return renderApp(request, reply, {
      entry: 'share',
      title: link.label || node.name,
      extraHead,
      data: {
        user: request.auth?.session ? { name: request.auth.user.name } : null,
        share: {
          token: link.token,
          label: link.label,
          owner: owner?.name ?? '',
          allowDownload: Boolean(link.allow_download),
          allowUpload: Boolean(link.allow_upload),
          uploadOnly: Boolean(link.upload_only),
          expiresAt: link.expires_at,
          node: presentPublic([node])[0],
        },
      },
    });
  });

  app.post<TokenParams>('/s/:token', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const resolved = resolveToken(request.params.token);
    if (!resolved) {
      return renderDocument(request, reply, { title: t(request.lang, 'Link ungültig'), status: 404, body: invalidPage(request) });
    }
    const { link, node } = resolved;
    const form = body<{ _csrf?: string; password?: string }>(request);
    try {
      checkFormCsrf(request, form._csrf);
      unlockAttempts.check(`${request.ip}:${link.id}`);
      if (!(await verifyPassword(link.password_hash, String(form.password ?? '')))) {
        unlockAttempts.hit(`${request.ip}:${link.id}`);
        throw forbidden('Das Passwort stimmt nicht');
      }
      reply.setCookie(unlockCookie(link), unlockToken(link), {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure(request),
        maxAge: 7 * 86_400,
      });
      return reply.redirect(`/s/${link.token}`, 303);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      return renderDocument(request, reply, {
        title: t(request.lang, 'Geschützter Link'),
        status: error.status,
        body: sharePasswordPage(request, { csrf: request.csrf, name: node.name, error: t(request.lang, error.message, error.params) }),
      });
    }
  });

  app.get<TokenParams>('/s/:token/thumb', { compress: false }, async (request, reply) => {
    const { link, node } = linkFor(request);
    if (link.upload_only || node.type !== 'file') throw notFound();
    return sendThumb(request, reply, node);
  });

  app.get<TokenParams>('/api/public/:token', async (request) => {
    const { link, node } = linkFor(request);
    return {
      share: {
        token: link.token,
        label: link.label,
        owner: getUser(link.owner_id)?.name ?? '',
        allowDownload: Boolean(link.allow_download),
        allowUpload: Boolean(link.allow_upload),
        uploadOnly: Boolean(link.upload_only),
        expiresAt: link.expires_at,
        node: presentPublic([node])[0],
      },
    };
  });

  app.get<{ Params: { token: string; id: string } }>('/api/public/:token/nodes/:id/children', async (request) => {
    const { link } = linkFor(request);
    if (link.upload_only) throw forbidden('Über diesen Link kannst du nur hochladen');
    const folder = linkFolder(link, request.params.id);
    return {
      folder: presentPublic([folder])[0],
      breadcrumbs: publicCrumbs(link, folder),
      items: presentPublic(children(folder.id)),
    };
  });

  app.get<{ Params: { token: string; id: string }; Querystring: { download?: string } }>(
    '/api/public/:token/nodes/:id/content',
    { compress: false },
    async (request, reply) => {
      const { link } = linkFor(request);
      const node = linkNode(link, request.params.id);
      if (node.type !== 'file' || link.upload_only) throw notFound();
      const download = request.query.download === '1';
      if (download && !link.allow_download) throw forbidden('Herunterladen ist für diesen Link ausgeschaltet');
      if (download && !request.headers.range) countAccess(link, 'downloads');
      return sendNode(request, reply, node, download);
    }
  );

  app.get<{ Params: { token: string; id: string } }>('/api/public/:token/nodes/:id/thumb', { compress: false }, async (request, reply) => {
    const { link } = linkFor(request);
    if (link.upload_only) throw notFound();
    return sendThumb(request, reply, linkNode(link, request.params.id));
  });

  app.get<{ Params: { token: string; id: string } }>('/api/public/:token/nodes/:id/meta', async (request) => {
    const { link } = linkFor(request);
    if (link.upload_only) throw notFound();
    const meta = nodeMeta(linkNode(link, request.params.id));
    return { ...meta, scan: meta.scan?.status === 'infected' ? meta.scan : null };
  });

  app.get<{ Params: { token: string; id: string } }>('/api/public/:token/nodes/:id/archive', async (request) => {
    const { link } = linkFor(request);
    if (link.upload_only) throw notFound();
    return archiveListing(linkNode(link, request.params.id));
  });

  app.get<{ Params: { token: string; id: string }; Querystring: { path?: string } }>(
    '/api/public/:token/nodes/:id/archive/entry',
    { compress: false },
    async (request, reply) => {
      const { link } = linkFor(request);
      if (link.upload_only) throw notFound();
      if (!link.allow_download) throw forbidden('Herunterladen ist für diesen Link ausgeschaltet');
      return sendArchiveEntry(reply, linkNode(link, request.params.id), String(request.query.path ?? ''));
    }
  );

  app.get<TokenParams & { Querystring: { ids?: string } }>('/api/public/:token/zip', { compress: false }, async (request, reply) => {
    const { link } = linkFor(request);
    if (!link.allow_download || link.upload_only) throw forbidden('Herunterladen ist für diesen Link ausgeschaltet');
    const list = String(request.query.ids ?? '')
      .split(',')
      .filter(Boolean);
    const roots = list.length ? parse(ids, list).map((nodeId) => linkNode(link, nodeId)) : [linkNode(link, link.node_id)];
    countAccess(link, 'downloads');
    return sendZip(request, reply, roots);
  });

  uploadEndpoints(
    app,
    '/api/public/:token',
    (request) => ({ user: null, link: linkFor(request as FastifyRequest<TokenParams>).link }),
    (request, nodeId) => {
      const { link } = linkFor(request as FastifyRequest<TokenParams>);
      return link.upload_only ? { id: nodeId } : presentPublic([linkNode(link, nodeId)])[0];
    }
  );
}
