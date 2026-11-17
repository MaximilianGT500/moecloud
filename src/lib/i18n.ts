import en from '../i18n/en.json' with { type: 'json' };

export type Lang = 'de' | 'en';

const english = en as Record<string, string>;

export function t(lang: Lang, text: string, params?: Record<string, string | number>): string {
  const template = lang === 'en' ? (english[text] ?? text).split('|')[0] : text;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in params ? String(params[key]) : match));
}

export const messagesFor = (lang: Lang) => (lang === 'en' ? english : null);

export const longDate = (lang: Lang, time: number) =>
  new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'long' }).format(new Date(time));

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function sizeIn(lang: Lang, bytes: number) {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'de-DE', { maximumFractionDigits: digits }).format(value)} ${UNITS[unit]}`;
}

export const isLang = (value: unknown): value is Lang => value === 'de' || value === 'en';

export function fromAcceptLanguage(header: string | undefined): Lang | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      return { tag: tag.toLowerCase().slice(0, 2), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) if (isLang(tag)) return tag;
  return null;
}
