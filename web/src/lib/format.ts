import { locale, t } from './i18n';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number | null | undefined, digits = 1) {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '';
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 || value >= 100 ? 0 : digits }).format(value);
  return `${formatted} ${UNITS[unit]}`;
}

export const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export function formatDate(time: number | null | undefined) {
  if (!time) return '';
  const date = new Date(time);
  const now = new Date();
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  if (sameDay(date, now)) return t('Heute, {time}', { time: clock });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return t('Gestern, {time}', { time: clock });
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export const formatTime = (time: number) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(time));

export function formatDayLabel(time: number) {
  const date = new Date(time);
  const now = new Date();
  if (sameDay(date, now)) return t('Heute');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return t('Gestern');
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { weekday: 'long', day: 'numeric', month: 'long' }
      : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export const formatMonth = (time: number) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(time));

export const formatDateTime = (time: number | null | undefined) =>
  time ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time)) : '';

export const formatDay = (time: number | null | undefined) =>
  time ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(time)) : '';

export function formatRelative(time: number) {
  const seconds = Math.round((time - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return format.format(0, 'minute');
}

export function deviceOf(agent: string | null) {
  if (!agent) return t('Unbekanntes Gerät');
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /OPR\//.test(agent)
      ? 'Opera'
      : /Firefox\//.test(agent)
        ? 'Firefox'
        : /Chrome\//.test(agent)
          ? 'Chrome'
          : /Safari\//.test(agent)
            ? 'Safari'
            : /curl|rclone|WebDAV|Microsoft-WebDAV|davfs|gvfs/i.test(agent)
              ? agent.split(/[ /]/)[0]
              : t('Browser');
  const system = /Windows/.test(agent)
    ? 'Windows'
    : /iPhone|iPad/.test(agent)
      ? 'iOS'
      : /Android/.test(agent)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : '';
  return system ? t('{browser} auf {system}', { browser, system }) : browser;
}

const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
export const compareNames = (a: string, b: string) => collator.compare(a, b);

export function splitExtension(name: string): [string, string] {
  const index = name.lastIndexOf('.');
  if (index <= 0) return [name, ''];
  return [name.slice(0, index), name.slice(index)];
}
