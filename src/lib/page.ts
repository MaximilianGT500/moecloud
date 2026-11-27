const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
};

export function decodeEntities(value: string) {
  return value.replace(/&(?:#x([0-9a-f]{1,6})|#([0-9]{1,7})|([a-z]{2,8}));/gi, (all, hex: string, dec: string, named: string) => {
    if (named) return ENTITIES[named] ?? ENTITIES[named.toLowerCase()] ?? all;
    const code = hex ? Number.parseInt(hex, 16) : Number(dec);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

export const plainText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style|template|noscript)[\s>][\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

export const oneLine = (value: string, max: number) => {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

export function tagsNamed(html: string, name: string) {
  const found: Record<string, string>[] = [];
  const pattern = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  for (const match of html.matchAll(pattern)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const key = attribute[1].toLowerCase();
      if (!(key in attributes)) attributes[key] = decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? '');
    }
    found.push(attributes);
    if (found.length > 400) break;
  }
  return found;
}

export function absolute(value: string | undefined | null, base: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface PageMeta {
  title: string;
  description: string;
  site: string;
  icon: string | null;
  iconGuessed: boolean;
  image: string | null;
  feeds: { url: string; title: string; type: string }[];
}

const FEED_TYPES = /^application\/(rss|atom|feed|rdf)\+(xml|json)$|^application\/json$|^text\/xml$|^application\/xml$/;

export function pageMeta(source: string, base: string): PageMeta {
  const html = source.slice(0, 600_000);
  const head = html.slice(0, Math.max(html.search(/<body[\s>]/i), 0) || html.length);
  const metas = tagsNamed(head, 'meta');
  const meta = (...keys: string[]) => {
    for (const key of keys) {
      const hit = metas.find(
        (entry) => (entry.property ?? entry.name ?? entry.itemprop ?? '').toLowerCase() === key && entry.content?.trim()
      );
      if (hit) return hit.content.trim();
    }
    return '';
  };
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1] ?? '';
  const links = tagsNamed(head, 'link');
  const rel = (entry: Record<string, string>) => (entry.rel ?? '').toLowerCase().split(/\s+/);
  const icons = links
    .filter(
      (entry) =>
        rel(entry).some((value) => value === 'icon' || value === 'apple-touch-icon' || value === 'apple-touch-icon-precomposed') &&
        entry.href
    )
    .map((entry) => {
      const size = Math.max(0, ...(entry.sizes ?? '').split(/\s+/).map((value) => Number.parseInt(value, 10) || 0));
      const svg = /svg/i.test(entry.type ?? '') || /\.svg(\?|$)/i.test(entry.href);
      return { href: entry.href, score: svg ? 1000 : rel(entry).includes('apple-touch-icon') ? 180 : size || 32 };
    })
    .sort((a, b) => b.score - a.score);
  const feeds = links
    .filter((entry) => rel(entry).includes('alternate') && entry.href && FEED_TYPES.test((entry.type ?? '').toLowerCase()))
    .map((entry) => ({ url: absolute(entry.href, base), title: oneLine(entry.title ?? '', 120), type: (entry.type ?? '').toLowerCase() }))
    .filter((entry): entry is { url: string; title: string; type: string } => Boolean(entry.url))
    .filter((entry, index, all) => all.findIndex((other) => other.url === entry.url) === index)
    .slice(0, 10);
  return {
    title: oneLine(decodeEntities(meta('og:title', 'twitter:title') || titleTag.replace(/<[^>]*>/g, '')), 300),
    description: oneLine(meta('og:description', 'description', 'twitter:description'), 600),
    site: oneLine(meta('og:site_name', 'application-name'), 120),
    icon: absolute(icons[0]?.href, base) ?? absolute('/favicon.ico', base),
    iconGuessed: !absolute(icons[0]?.href, base),
    image: absolute(meta('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), base),
    feeds,
  };
}
