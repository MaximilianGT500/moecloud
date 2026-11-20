import { lookup } from './lookup.ts';

const WITH_CONTENT = new Set(['script', 'iframe', 'frameset', 'object', 'applet', 'noscript', 'template', 'noembed', 'noframes']);
const DROPPED = new Set([
  ...WITH_CONTENT,
  'embed',
  'frame',
  'meta',
  'base',
  'link',
  'form',
  'plaintext',
  'set',
  'animate',
  'animatetransform',
  'animatemotion',
  'handler',
  'listener',
]);
const LINKS = new Set(['href', 'xlink:href', 'action', 'formaction', 'data', 'ping', 'manifest']);
const SOURCES = new Set(['src', 'background', 'poster', 'lowsrc', 'dynsrc']);
const NEVER = new Set(['srcdoc', 'srcset', 'imagesrcset', 'http-equiv', 'autofocus', 'attributename']);
const NAME = /^[a-z_][a-z0-9_:.-]*$/;
const SPACE = new Set([' ', '\t', '\n', '\r', '\f']);
const NAMED: Record<string, string> = lookup({
  colon: ':',
  tab: '\t',
  newline: '\n',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  sol: '/',
});

const INVISIBLE = new RegExp(
  `[\\x00-\\x20\\x7f-\\x9f${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}${String.fromCharCode(0x2028, 0x2029, 0xfeff)}]+`,
  'g'
);

function decoded(value: string) {
  return value.replace(/&(?:#x([0-9a-f]{1,6})|#([0-9]{1,7})|([a-z]{2,8}));?/gi, (all, hex: string, dec: string, named: string) => {
    if (named) return NAMED[named.toLowerCase()] ?? all;
    const code = hex ? Number.parseInt(hex, 16) : Number(dec);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function safeUrl(value: string, images: boolean) {
  const url = decoded(value).replace(INVISIBLE, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(url)?.[1];
  if (!scheme) return true;
  if (scheme === 'data') return images && /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|svg\+xml)[;,]/.test(url);
  return scheme === 'https' || scheme === 'http' || scheme === 'mailto' || scheme === 'tel' || scheme === 'cid';
}

function attributes(html: string, start: number) {
  const found: [string, string | null][] = [];
  const length = html.length;
  let at = start;
  for (;;) {
    while (at < length && (SPACE.has(html[at]) || html[at] === '/')) at++;
    if (at >= length) return { found, end: length };
    if (html[at] === '>') return { found, end: at + 1 };
    const nameStart = at;
    if (html[at] === '=') at++;
    while (at < length && !SPACE.has(html[at]) && html[at] !== '/' && html[at] !== '>' && html[at] !== '=') at++;
    const name = html.slice(nameStart, at).toLowerCase();
    while (at < length && SPACE.has(html[at])) at++;
    let value: string | null = null;
    if (html[at] === '=') {
      at++;
      while (at < length && SPACE.has(html[at])) at++;
      const quote = html[at];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, at + 1);
        value = html.slice(at + 1, close === -1 ? length : close);
        at = close === -1 ? length : close + 1;
      } else {
        const valueStart = at;
        while (at < length && !SPACE.has(html[at]) && html[at] !== '>') at++;
        value = html.slice(valueStart, at);
      }
    }
    found.push([name, value]);
  }
}

function tag(name: string, found: [string, string | null][]) {
  let out = `<${name}`;
  const seen = new Set<string>();
  for (const [key, value] of found) {
    if (!NAME.test(key) || seen.has(key) || key.startsWith('on') || NEVER.has(key)) continue;
    if (value !== null && LINKS.has(key) && !safeUrl(value, false)) continue;
    if (value !== null && SOURCES.has(key) && !safeUrl(value, true)) continue;
    seen.add(key);
    out += value === null ? ` ${key}` : ` ${key}="${value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
  }
  return `${out}>`;
}

export function defuse(html: string): string {
  const length = html.length;
  const out: string[] = [];
  let at = 0;
  while (at < length) {
    const open = html.indexOf('<', at);
    if (open === -1) {
      out.push(html.slice(at));
      break;
    }
    out.push(html.slice(at, open));
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      at = end === -1 ? length : end + 3;
      continue;
    }
    const next = html[open + 1];
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', open);
      at = end === -1 ? length : end + 1;
      continue;
    }
    const closing = next === '/';
    const nameStart = open + (closing ? 2 : 1);
    let nameEnd = nameStart;
    while (nameEnd < length && nameEnd - nameStart < 40 && /[a-zA-Z0-9:-]/.test(html[nameEnd])) nameEnd++;
    const name = html.slice(nameStart, nameEnd).toLowerCase();
    if (!/^[a-z][a-z0-9:-]*$/.test(name)) {
      out.push('&lt;');
      at = open + 1;
      continue;
    }
    const parsed = attributes(html, nameEnd);
    at = parsed.end;
    if (DROPPED.has(name)) {
      if (name === 'plaintext') break;
      if (!closing && WITH_CONTENT.has(name)) {
        const close = new RegExp(`</${name}[\\s/>]`, 'gi');
        close.lastIndex = at;
        const found = close.exec(html);
        if (!found) break;
        at = attributes(html, found.index + name.length + 2).end;
      }
      continue;
    }
    out.push(closing ? `</${name}>` : tag(name, parsed.found));
  }
  return out.join('');
}
