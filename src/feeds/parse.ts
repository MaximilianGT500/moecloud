import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { absolute, decodeEntities, oneLine, plainText } from '../lib/page.ts';

export interface ParsedItem {
  guid: string;
  url: string;
  title: string;
  author: string;
  summary: string;
  content: string;
  image: string | null;
  media: string | null;
  mediaType: string | null;
  duration: number | null;
  publishedAt: number | null;
}

export interface ParsedFeed {
  title: string;
  site: string;
  icon: string | null;
  podcast: boolean;
  items: ParsedItem[];
}

const LISTS = new Set([
  'item',
  'entry',
  'link',
  'category',
  'enclosure',
  'media:content',
  'media:thumbnail',
  'author',
  'media:group',
  'outline',
]);
const MAX_ITEMS = 300;

type Node = Record<string, unknown>;

const parser = () =>
  new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    htmlEntities: true,
    processEntities: { enabled: true, maxTotalExpansions: 2000, maxExpandedLength: 2_000_000, maxEntityCount: 200 },
    ignoreDeclaration: true,
    ignorePiTags: true,
    maxNestedTags: 200,
    stopNodes: ['*.entry.content', '*.entry.summary', 'feed.entry.content', 'feed.entry.summary'],
    isArray: (name) => LISTS.has(name),
  });

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]);

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === 'object') return text((value as Node)['#text']);
  return '';
}

const attr = (value: unknown, name: string) =>
  value && typeof value === 'object' && !Array.isArray(value) ? text((value as Node)[`@_${name}`]) : '';

function rawXml(value: unknown): { raw: string; type: string } {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return { raw: text((value as Node)['#text']), type: attr(value, 'type').toLowerCase() };
  return { raw: text(value), type: '' };
}

function unwrap(raw: string) {
  const parts: string[] = [];
  let rest = raw;
  for (;;) {
    const start = rest.indexOf('<![CDATA[');
    if (start === -1) {
      parts.push(decodeEntities(rest));
      break;
    }
    parts.push(decodeEntities(rest.slice(0, start)));
    const end = rest.indexOf(']]>', start + 9);
    parts.push(rest.slice(start + 9, end === -1 ? rest.length : end));
    if (end === -1) break;
    rest = rest.slice(end + 3);
  }
  return parts.join('');
}

function atomText(value: unknown) {
  const { raw, type } = rawXml(value);
  if (!raw) return '';
  if (type === 'xhtml') return raw.replace(/^\s*<div[^>]*>/i, '').replace(/<\/div>\s*$/i, '');
  const decoded = unwrap(raw);
  if (type === 'html' || type === 'text/html') return decoded;
  return decoded.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!).replace(/\n/g, '<br>');
}

function date(value: string) {
  if (!value) return null;
  let parsed = Date.parse(value);
  if (Number.isNaN(parsed)) parsed = Date.parse(value.replace(/\s+([A-Z]{3,4})$/, ' GMT').replace(/^\w{2,4},?\s*/, ''));
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

function duration(value: string) {
  if (!value) return null;
  if (/^\d+(\.\d+)?$/.test(value.trim())) return Math.round(Number(value));
  const parts = value
    .trim()
    .split(':')
    .map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part)) || parts.length > 3) return null;
  return Math.round(parts.reduce((total, part) => total * 60 + part, 0));
}

const MEDIA = /^(audio|video)\//;
const MEDIA_FILE = /\.(mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac|mp4|m4v|webm|mov)(\?|$)/i;

function mediaGuess(url: string) {
  const extension = MEDIA_FILE.exec(url)?.[1]?.toLowerCase();
  if (!extension) return null;
  return (
    {
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      m4b: 'audio/mp4',
      aac: 'audio/aac',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      opus: 'audio/ogg',
      wav: 'audio/wav',
      flac: 'audio/flac',
      mp4: 'video/mp4',
      m4v: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
    } as Record<string, string>
  )[extension];
}

function firstImage(html: string, base: string) {
  const found = /<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  return found ? absolute(decodeEntities(found), base) : null;
}

function finish(item: Omit<ParsedItem, 'guid'> & { guid: string }, base: string): ParsedItem {
  const summary = oneLine(plainText(item.summary || item.content), 500);
  const guid = (
    item.guid ||
    item.url ||
    createHash('sha256')
      .update(`${item.title}\u0000${item.publishedAt ?? ''}\u0000${summary}`)
      .digest('hex')
  ).slice(0, 500);
  return {
    ...item,
    guid,
    title: oneLine(item.title, 500) || oneLine(summary, 120),
    author: oneLine(plainText(item.author), 200),
    summary,
    content: item.content.slice(0, 400_000),
    image: item.image ?? firstImage(item.content || item.summary, base),
  };
}

function rss(channel: Node, base: string): ParsedFeed {
  const site = absolute(text(asArray(channel.link).find((entry) => typeof entry === 'string' || !attr(entry, 'rel'))), base) ?? base;
  const items = asArray(channel.item)
    .slice(0, MAX_ITEMS)
    .map((value) => {
      const item = value as Node;
      const link =
        absolute(text(asArray(item.link)[0]), site) ??
        absolute(attr(item.guid, 'isPermaLink') !== 'false' ? text(item.guid) : '', site) ??
        '';
      const enclosures = asArray(item.enclosure).map((entry) => ({
        url: absolute(attr(entry, 'url'), site),
        type: attr(entry, 'type').toLowerCase(),
      }));
      const groups = asArray(item['media:group']).flatMap((group) => asArray((group as Node)['media:content']));
      const contents = [...asArray(item['media:content']), ...groups].map((entry) => ({
        url: absolute(attr(entry, 'url'), site),
        type: attr(entry, 'type').toLowerCase(),
        medium: attr(entry, 'medium'),
      }));
      const media =
        enclosures.find((entry) => entry.url && (MEDIA.test(entry.type) || (!entry.type && mediaGuess(entry.url)))) ??
        contents.find((entry) => entry.url && (MEDIA.test(entry.type) || entry.medium === 'audio' || entry.medium === 'video'));
      const image =
        absolute(attr(asArray(item['media:thumbnail'])[0], 'url'), site) ??
        contents.find((entry) => entry.url && (entry.medium === 'image' || entry.type.startsWith('image/')))?.url ??
        enclosures.find((entry) => entry.url && entry.type.startsWith('image/'))?.url ??
        absolute(attr(item['itunes:image'], 'href'), site);
      const content = text(item['content:encoded']) || text(item.description);
      return finish(
        {
          guid: text(item.guid),
          url: link,
          title: plainText(text(item.title)),
          author: text(item['dc:creator']) || text(asArray(item.author)[0]) || text(item['itunes:author']),
          summary: text(item.description) || text(item['itunes:summary']) || text(item['itunes:subtitle']),
          content,
          image: image ?? null,
          media: media?.url ?? null,
          mediaType: media ? media.type || mediaGuess(media.url!) || 'audio/mpeg' : null,
          duration: duration(text(item['itunes:duration'])),
          publishedAt: date(text(item.pubDate) || text(item['dc:date']) || text(item.published) || text(item.updated)),
        },
        link || site
      );
    });
  const icon = absolute(text((channel.image as Node | undefined)?.url), site) ?? absolute(attr(channel['itunes:image'], 'href'), site);
  return {
    title: oneLine(plainText(text(channel.title)), 200),
    site,
    icon: icon ?? null,
    podcast:
      items.filter((item) => item.media).length * 2 > items.length || Boolean(channel['itunes:author'] || channel['itunes:category']),
    items,
  };
}

function atom(feed: Node, base: string): ParsedFeed {
  const links = asArray(feed.link);
  const alternate = links.find((entry) => !attr(entry, 'rel') || attr(entry, 'rel') === 'alternate');
  const site = absolute(attr(alternate, 'href'), base) ?? base;
  const items = asArray(feed.entry)
    .slice(0, MAX_ITEMS)
    .map((value) => {
      const entry = value as Node;
      const entryLinks = asArray(entry.link);
      const link =
        absolute(
          attr(
            entryLinks.find((candidate) => !attr(candidate, 'rel') || attr(candidate, 'rel') === 'alternate'),
            'href'
          ),
          site
        ) ?? '';
      const enclosure = entryLinks.find(
        (candidate) =>
          attr(candidate, 'rel') === 'enclosure' && (MEDIA.test(attr(candidate, 'type')) || mediaGuess(attr(candidate, 'href')))
      );
      const group = asArray(entry['media:group'])[0] as Node | undefined;
      const thumbnail = asArray(entry['media:thumbnail'])[0] ?? asArray(group?.['media:thumbnail'])[0];
      const content = atomText(entry.content);
      const summary = atomText(entry.summary) || text(group?.['media:description']);
      const mediaUrl = enclosure ? absolute(attr(enclosure, 'href'), site) : null;
      return finish(
        {
          guid: text(entry.id),
          url: link,
          title: /html/.test(attr(entry.title, 'type').toLowerCase()) ? plainText(text(entry.title)) : text(entry.title),
          author: text((asArray(entry.author)[0] as Node | undefined)?.name) || text((asArray(feed.author)[0] as Node | undefined)?.name),
          summary,
          content: content || summary,
          image: absolute(attr(thumbnail, 'url'), site),
          media: mediaUrl,
          mediaType: mediaUrl ? attr(enclosure, 'type') || mediaGuess(mediaUrl) || 'audio/mpeg' : null,
          duration: null,
          publishedAt: date(text(entry.published) || text(entry.updated) || text(entry.issued) || text(entry.modified)),
        },
        link || site
      );
    });
  return {
    title: oneLine(plainText(text(feed.title)), 200),
    site,
    icon: absolute(text(feed.icon), base) ?? absolute(text(feed.logo), base),
    podcast: items.filter((item) => item.media).length * 2 > items.length,
    items,
  };
}

function rdf(root: Node, base: string): ParsedFeed {
  const channel = (root.channel ?? {}) as Node;
  return rss({ ...channel, item: root.item ?? channel.item, image: root.image ?? channel.image }, base);
}

function jsonFeed(data: Node, base: string): ParsedFeed {
  const site = absolute(text(data.home_page_url), base) ?? base;
  const items = asArray(data.items)
    .slice(0, MAX_ITEMS)
    .filter((value) => value && typeof value === 'object')
    .map((value) => {
      const item = value as Node;
      const attachment = asArray(item.attachments).find((entry) => {
        const type = text((entry as Node).mime_type);
        return MEDIA.test(type) || mediaGuess(text((entry as Node).url));
      }) as Node | undefined;
      const url = absolute(text(item.url) || text(item.external_url), site) ?? '';
      const html = text(item.content_html);
      const plain = text(item.content_text);
      const authors = asArray(item.authors ?? data.authors ?? (item.author ? [item.author] : []));
      return finish(
        {
          guid: text(item.id),
          url,
          title: text(item.title).replace(/\s+/g, ' '),
          author: text((authors[0] as Node | undefined)?.name),
          summary: text(item.summary),
          content: html || plain.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!).replace(/\n/g, '<br>'),
          image: absolute(text(item.image) || text(item.banner_image), site),
          media: attachment ? absolute(text(attachment.url), site) : null,
          mediaType: attachment ? text(attachment.mime_type) || mediaGuess(text(attachment.url)) || 'audio/mpeg' : null,
          duration: attachment && typeof attachment.duration_in_seconds === 'number' ? Math.round(attachment.duration_in_seconds) : null,
          publishedAt: date(text(item.date_published) || text(item.date_modified)),
        },
        url || site
      );
    });
  return {
    title: oneLine(text(data.title), 200),
    site,
    icon: absolute(text(data.icon) || text(data.favicon), base),
    podcast: items.filter((item) => item.media).length * 2 > items.length,
    items,
  };
}

export function looksLikeFeed(body: string) {
  const head = body.slice(0, 2000).trimStart();
  return (
    /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<\?xml-stylesheet[^>]*>\s*)*<(rss|feed|rdf:RDF)[\s>]/i.test(head) ||
    (/^\{/.test(head) && /jsonfeed\.org\/version/i.test(body.slice(0, 4000)))
  );
}

export function parseFeed(body: string, base: string): ParsedFeed {
  const trimmed = body.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('{')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('feed_invalid');
    }
    if (!data || typeof data !== 'object' || !Array.isArray((data as Node).items)) throw new Error('feed_invalid');
    return jsonFeed(data as Node, base);
  }
  const xml = trimmed.replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  let tree: Node;
  try {
    tree = parser().parse(xml) as Node;
  } catch {
    throw new Error('feed_invalid');
  }
  if (tree.rss && typeof tree.rss === 'object') {
    const channel = (tree.rss as Node).channel;
    return rss((Array.isArray(channel) ? channel[0] : (channel ?? {})) as Node, base);
  }
  if (tree.feed && typeof tree.feed === 'object') return atom(tree.feed as Node, base);
  if (tree['rdf:RDF'] && typeof tree['rdf:RDF'] === 'object') return rdf(tree['rdf:RDF'] as Node, base);
  throw new Error('feed_invalid');
}

export interface Outline {
  url: string;
  title: string;
  folder: string;
}

export function parseOpml(body: string) {
  const xml = body.replace(/^﻿/, '').replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, '');
  let tree: Node;
  try {
    tree = parser().parse(xml) as Node;
  } catch {
    throw new Error('opml_invalid');
  }
  const found: Outline[] = [];
  const walk = (nodes: unknown[], folder: string) => {
    for (const value of nodes) {
      const node = value as Node;
      const url = attr(node, 'xmlUrl');
      const title = attr(node, 'title') || attr(node, 'text');
      if (url) found.push({ url, title: oneLine(title, 200), folder });
      else walk(asArray(node.outline), oneLine(title, 60) || folder);
      if (found.length >= 2000) return;
    }
  };
  walk(asArray(((tree.opml as Node | undefined)?.body as Node | undefined)?.outline), '');
  return found;
}

const xmlEscape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

export function buildOpml(feeds: { url: string; title: string; site: string; folder: string }[], title: string) {
  const folders = new Map<string, typeof feeds>();
  for (const feed of feeds) folders.set(feed.folder, [...(folders.get(feed.folder) ?? []), feed]);
  const line = (feed: (typeof feeds)[number], indent: string) =>
    `${indent}<outline type="rss" text="${xmlEscape(feed.title || feed.url)}" title="${xmlEscape(feed.title || feed.url)}" xmlUrl="${xmlEscape(feed.url)}"${feed.site ? ` htmlUrl="${xmlEscape(feed.site)}"` : ''}/>`;
  const body: string[] = [];
  for (const [folder, entries] of folders) {
    if (!folder) body.push(...entries.map((feed) => line(feed, '    ')));
    else
      body.push(
        `    <outline text="${xmlEscape(folder)}" title="${xmlEscape(folder)}">`,
        ...entries.map((feed) => line(feed, '      ')),
        '    </outline>'
      );
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${xmlEscape(title)}</title>`,
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    '  </head>',
    '  <body>',
    ...body,
    '  </body>',
    '</opml>',
    '',
  ].join('\n');
}
