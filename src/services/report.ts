import { all, one } from '../lib/db.ts';
import { longDate, sizeIn, t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { deliver, mailReady } from './mail.ts';
import { openReports } from './reports.ts';
import * as settings from './settings.ts';
import { updateStatus } from './updates.ts';
import { dayOf } from './usage.ts';
import { ACTIVE, preferredLanguage, prefsOf, type UserRow } from './users.ts';

const WEEK = 7 * 24 * 60 * 60 * 1000;

const count = (sql: string, ...params: (string | number)[]) => Number(one<{ n: number }>(sql, ...params)?.n ?? 0);
const many = (lang: Lang, value: number, one: string, other: string) => t(lang, value === 1 ? one : other, { count: value });

export function weeklyReport(lang: Lang, now = Date.now()) {
  const since = now - WEEK;
  const today = one<{ bytes: number; files: number }>(
    'SELECT bytes, files FROM usage_days WHERE day <= ? ORDER BY day DESC LIMIT 1',
    dayOf(now)
  );
  const before = one<{ bytes: number; files: number }>(
    'SELECT bytes, files FROM usage_days WHERE day <= ? ORDER BY day DESC LIMIT 1',
    dayOf(since)
  );
  const bytes = Number(today?.bytes ?? 0);
  const grown = bytes - Number(before?.bytes ?? bytes);
  const users = count(`SELECT COUNT(*) AS n FROM users WHERE ${ACTIVE}`, now);
  const joined = count('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since);
  const logins = count(`SELECT COUNT(*) AS n FROM audit WHERE action = 'login' AND created_at >= ?`, since);
  const failed = count(`SELECT COUNT(*) AS n FROM audit WHERE action = 'login_failed' AND created_at >= ?`, since);
  const links = count('SELECT COUNT(*) AS n FROM links WHERE created_at >= ?', since);
  const viruses = count(`SELECT COUNT(*) AS n FROM audit WHERE action = 'virus_found' AND created_at >= ?`, since);
  const reports = openReports();
  const backup = settings.get('backup.last');
  const update = updateStatus();
  const lines = [
    t(lang, 'Speicher: {size} belegt, {change} in den letzten sieben Tagen.', {
      size: sizeIn(lang, bytes),
      change: `${grown < 0 ? '−' : '+'}${sizeIn(lang, Math.abs(grown))}`,
    }),
    `${many(lang, users, 'Konten: {count} aktives Konto', 'Konten: {count} aktive Konten')}, ${many(lang, joined, '{count} neues diese Woche.', '{count} neue diese Woche.')}`,
    `${many(lang, logins, 'Anmeldungen: {count} erfolgreich', 'Anmeldungen: {count} erfolgreich')}, ${many(lang, failed, '{count} fehlgeschlagen.', '{count} fehlgeschlagen.')}`,
    many(lang, links, 'Teilen: {count} neuer Link.', 'Teilen: {count} neue Links.'),
  ];
  if (reports) lines.push(many(lang, reports, 'Offen: {count} Meldung zu einem Link.', 'Offen: {count} Meldungen zu Links.'));
  if (viruses) lines.push(many(lang, viruses, 'Virenscan: {count} Fund.', 'Virenscan: {count} Funde.'));
  lines.push(
    !settings.get('backup.enabled')
      ? t(lang, 'Sicherung: Die automatische Sicherung ist ausgeschaltet.')
      : backup
        ? t(lang, 'Sicherung: zuletzt am {date}.', { date: longDate(lang, backup) })
        : t(lang, 'Sicherung: Es gibt noch keine.')
  );
  if (update.available && update.latest) lines.push(t(lang, 'Update: Version {version} ist da.', { version: update.latest.version }));
  return { title: t(lang, 'Wochenbericht für {site}', { site: settings.get('site.name') }), lines };
}

async function send(admin: Pick<UserRow, 'email' | 'language' | 'id'> & UserRow, now: number) {
  const lang = preferredLanguage(admin);
  const report = weeklyReport(lang, now);
  await deliver(admin.email!, {
    lang,
    title: report.title,
    lines: report.lines,
    action: settings.get('site.url')
      ? { label: t(lang, 'Zur Verwaltung'), url: `${settings.get('site.url').replace(/\/+$/, '')}/admin` }
      : undefined,
    note: t(lang, 'Den Wochenbericht schaltest du unter Admin › Einstellungen aus.'),
  });
}

export async function sendReportTo(admin: UserRow, now = Date.now()) {
  if (!mailReady() || !admin.email) return false;
  await send(admin, now);
  return true;
}

export function reportDue(now = new Date()) {
  if (!settings.get('report.weekly') || !mailReady()) return null;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 8);
  if (now.getTime() < monday.getTime()) return null;
  const key = dayOf(monday.getTime() + 12 * 60 * 60 * 1000);
  return settings.get('report.sent') === key ? null : key;
}

export async function sendWeeklyReports(now = new Date()) {
  const key = reportDue(now);
  if (!key) return 0;
  settings.set('report.sent', key);
  const admins = all<UserRow>(`SELECT * FROM users WHERE role = 'admin' AND email IS NOT NULL AND ${ACTIVE}`, now.getTime());
  let sent = 0;
  for (const admin of admins) {
    if (!prefsOf(admin).mailAdmin) continue;
    try {
      await send(admin, now.getTime());
      sent += 1;
    } catch (error) {
      log.warn({ error: (error as Error).message }, 'Der Wochenbericht konnte nicht gesendet werden');
    }
  }
  return sent;
}
