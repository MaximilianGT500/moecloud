import type { FastifyReply, FastifyRequest } from 'fastify';
import { render } from 'preact-render-to-string';
import type { VNode } from 'preact';
import { config } from '../config.ts';
import * as settings from '../services/settings.ts';
import { baseUrl } from '../services/links.ts';
import { mailReady } from '../services/mail.ts';
import { unreadCount } from '../services/notify.ts';
import { entryTags, type Entry } from './assets.ts';
import { escapeHtml, serializeJson } from './http.ts';
import { messagesFor, t } from './i18n.ts';

const THEME_SCRIPT =
  "(function(){try{var d=document.documentElement,m=localStorage.getItem('mui-mode')||'dark';if(m==='system')m=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';if(m!=='light')m='dark';d.setAttribute('data-mui-color-scheme',m);d.style.colorScheme=m;}catch(e){}})();";

export function legalLinks(request: FastifyRequest) {
  const links: { label: string; href: string }[] = [];
  const imprint = settings.get('site.imprint').trim();
  const privacy = settings.get('site.privacy').trim();
  if (imprint) links.push({ label: t(request.lang, 'Impressum'), href: /^https?:\/\//.test(imprint) ? imprint : '/impressum' });
  if (privacy) links.push({ label: t(request.lang, 'Datenschutz'), href: /^https?:\/\//.test(privacy) ? privacy : '/datenschutz' });
  return links;
}

export function siteInfo(request: FastifyRequest) {
  return {
    name: settings.get('site.name'),
    url: baseUrl(request),
    seed: settings.get('site.seed'),
    palette: settings.get('site.palette'),
    version: config.version,
    registration: settings.get('auth.registration'),
    passkeys: settings.get('auth.passkeys'),
    legal: legalLinks(request),
    notice: settings.activeNotice(),
    maintenance: settings.get('maintenance.enabled'),
    mail: mailReady(),
  };
}

function paletteCss() {
  const palette = settings.get('site.palette');
  const vars = (tokens: Record<string, string>) =>
    Object.entries(tokens)
      .filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value))
      .map(([key, value]) => `--mui-palette-m3-${key}:${value}`)
      .join(';');
  return `:root,:root[data-mui-color-scheme=dark]{color-scheme:dark;${vars(palette.dark)}}:root[data-mui-color-scheme=light]{color-scheme:light;${vars(palette.light)}}`;
}

function baseCss(withTokens: boolean) {
  const palette = settings.get('site.palette');
  if (withTokens) {
    return `${paletteCss()}html,body{margin:0;background:var(--mui-palette-m3-surface);color:var(--mui-palette-m3-onSurface)}`;
  }
  const dark = palette.dark;
  const light = palette.light;
  return `html,body{margin:0;background:${dark.surface};color:${dark.onSurface}}html[data-mui-color-scheme=light],html[data-mui-color-scheme=light] body{background:${light.surface};color:${light.onSurface}}`;
}

function head(request: FastifyRequest, title: string, extra = '', withTokens = true) {
  const palette = settings.get('site.palette');
  const nonce = escapeHtml(request.nonce);
  const site = settings.get('site.name');
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title ? `${title} » ${site}` : site)}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${escapeHtml(palette.dark.surface ?? '#141218')}">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="${escapeHtml(palette.light.surface ?? '#fef7ff')}">
<meta property="csp-nonce" nonce="${nonce}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
${extra}<script nonce="${nonce}">${THEME_SCRIPT}</script>
<style nonce="${nonce}">${baseCss(withTokens)}.noscript{font-family:system-ui,sans-serif;padding:24px;max-width:560px;margin:0 auto;line-height:1.5}</style>`;
}

function missingBuild(request: FastifyRequest) {
  return `<!doctype html><html lang="${request.lang}"><head><meta charset="utf-8"><title>MoeCloud</title></head><body><main class="noscript"><h1>${escapeHtml(
    t(request.lang, 'Die Oberfläche fehlt')
  )}</h1><p>${escapeHtml(t(request.lang, 'Baue sie mit „npm run build“ und starte den Server neu.'))}</p></main></body></html>`;
}

export interface AppPage {
  entry: Exclude<Entry, 'auth'>;
  title: string;
  data?: Record<string, unknown>;
  status?: number;
  extraHead?: string;
}

export function renderApp(request: FastifyRequest, reply: FastifyReply, page: AppPage) {
  const tags = entryTags(page.entry, request.nonce);
  reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
  if (!tags) return reply.code(503).send(missingBuild(request));
  const auth = request.auth;
  const boot = {
    page: page.entry,
    lang: request.lang,
    site: siteInfo(request),
    csrf: auth?.session?.csrf ?? request.csrf,
    unread: auth?.session ? unreadCount(auth.user.id) : 0,
    ...page.data,
  };
  const messages = messagesFor(request.lang);
  const html = `<!doctype html>
<html lang="${request.lang}" data-mui-color-scheme="dark">
<head>
${head(request, page.title, page.extraHead, false)}
${tags.head}
</head>
<body>
<div id="root"></div>
<noscript><p class="noscript">${escapeHtml(t(request.lang, 'Für diese Seite brauchst du JavaScript.'))}</p></noscript>
<script type="application/json" id="moe-boot">${serializeJson(boot)}</script>
${messages ? `<script type="application/json" id="moe-i18n">${serializeJson(messages)}</script>\n` : ''}${tags.body}
</body>
</html>`;
  return reply.code(page.status ?? 200).send(html);
}

export interface DocumentPage {
  title: string;
  body: VNode | VNode[] | string;
  status?: number;
  extraHead?: string;
}

export function renderDocument(request: FastifyRequest, reply: FastifyReply, page: DocumentPage) {
  const tags = entryTags('auth', request.nonce);
  const html = `<!doctype html>
<html lang="${request.lang}" data-mui-color-scheme="dark">
<head>
${head(request, page.title, page.extraHead)}
${tags?.head ?? ''}
</head>
<body>
${typeof page.body === 'string' ? page.body : render(page.body as VNode)}
${tags?.body ?? ''}
</body>
</html>`;
  return reply
    .code(page.status ?? 200)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send(html);
}
