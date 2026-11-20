const decode = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');

export interface Weblink {
  url: string;
  host: string;
  safe: boolean;
}

export function parseWeblink(name: string, text: string): Weblink | null {
  const lower = name.toLowerCase();
  let raw = '';
  if (lower.endsWith('.webloc')) {
    raw = decode(/<key>\s*URL\s*<\/key>\s*<string>([^<]*)<\/string>/i.exec(text)?.[1] ?? '');
  } else {
    raw = /^URL\s*=\s*(.+)$/im.exec(text)?.[1] ?? '';
  }
  raw = raw.trim();
  if (!raw || raw.length > 4000) return null;
  try {
    const parsed = new URL(raw);
    const safe = (parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password;
    return { url: safe ? parsed.href : raw, host: parsed.host || parsed.protocol, safe };
  } catch {
    return null;
  }
}

export function weblinkFile(address: string) {
  const parsed = new URL(address.trim());
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('scheme');
  if (parsed.username || parsed.password) throw new Error('credentials');
  const name = `${parsed.hostname.replace(/^www\./, '')}${
    parsed.pathname.length > 1
      ? ` ${decodeURIComponent(parsed.pathname)
          .replace(/[\\/:*?"<>|]+/g, ' ')
          .trim()}`
      : ''
  }`
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  return { name: `${name || parsed.hostname}.url`, content: `[InternetShortcut]\r\nURL=${parsed.href}\r\n` };
}
