import { DAY } from '../../shared/time.ts';
import { t, type Lang } from '../lib/i18n.ts';

const locales: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' };

export function formatDay(lang: Lang, utc: number, zone = 'UTC') {
  return new Intl.DateTimeFormat(locales[lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone }).format(
    new Date(utc)
  );
}

export function formatClock(lang: Lang, utc: number, zone: string) {
  return new Intl.DateTimeFormat(locales[lang], { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(new Date(utc));
}

export function formatShort(lang: Lang, utc: number, zone: string) {
  return new Intl.DateTimeFormat(locales[lang], { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(utc));
}

export function formatWhen(lang: Lang, start: number, end: number | null, allDay: boolean, zone: string) {
  if (allDay) {
    const last = end && end - start > DAY ? end - DAY : null;
    if (last) return t(lang, '{from} bis {to} (ganztägig)', { from: formatDay(lang, start, 'UTC'), to: formatDay(lang, last, 'UTC') });
    return t(lang, '{date} (ganztägig)', { date: formatDay(lang, start, 'UTC') });
  }
  const day = formatDay(lang, start, zone);
  if (end === null || end === start) return `${day}, ${formatClock(lang, start, zone)}`;
  const sameDay = formatDay(lang, end, zone) === day;
  if (sameDay) return `${day}, ${formatClock(lang, start, zone)}–${formatClock(lang, end, zone)}`;
  return `${day}, ${formatClock(lang, start, zone)} – ${formatDay(lang, end, zone)}, ${formatClock(lang, end, zone)}`;
}

export function leadText(lang: Lang, minutes: number) {
  if (minutes <= 0) return t(lang, 'jetzt');
  if (minutes < 60) return minutes === 1 ? t(lang, 'in einer Minute') : t(lang, 'in {count} Minuten', { count: minutes });
  if (minutes < 24 * 60) {
    const hours = Math.round(minutes / 60);
    return hours === 1 ? t(lang, 'in einer Stunde') : t(lang, 'in {count} Stunden', { count: hours });
  }
  const days = Math.round(minutes / (24 * 60));
  return days === 1 ? t(lang, 'morgen') : t(lang, 'in {count} Tagen', { count: days });
}
