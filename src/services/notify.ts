import { all, placeholders, run, value } from '../lib/db.ts';
import { publish } from '../lib/events.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { deliver, mailReady } from './mail.ts';
import * as settings from './settings.ts';
import { getUser, preferredLanguage, prefsOf, type UserPrefs, type UserRow } from './users.ts';
import { dispatch, type WebhookEvent } from './webhooks.ts';

export type NotifyKind =
  | 'shared'
  | 'request_upload'
  | 'comment'
  | 'watch'
  | 'virus'
  | 'storage'
  | 'admin_user'
  | 'admin_virus'
  | 'admin_scan'
  | 'admin_backup'
  | 'admin_disk'
  | 'admin_update'
  | 'admin_logins';

type Params = Record<string, string | number>;

interface Kind {
  title: (lang: Lang, params: Params) => string;
  text?: (lang: Lang, params: Params) => string;
  pref?: keyof UserPrefs;
  action?: string;
  event?: WebhookEvent;
}

const many = (lang: Lang, count: number, one: string, other: string, params: Params) => t(lang, count === 1 ? one : other, params);

const KINDS: Record<NotifyKind, Kind> = {
  shared: {
    title: (lang, p) =>
      p.group ? t(lang, '{by} hat „{name}“ mit der Gruppe {group} geteilt', p) : t(lang, '{by} hat „{name}“ mit dir geteilt', p),
    text: (lang, p) =>
      p.permission === 'edit'
        ? t(lang, 'Du kannst den Inhalt ansehen und bearbeiten.')
        : t(lang, 'Du kannst den Inhalt ansehen und herunterladen.'),
    pref: 'mailShares',
    action: 'Ansehen',
  },
  request_upload: {
    title: (lang, p) => many(lang, Number(p.count), 'Eine Datei kam über „{label}“ an', '{count} Dateien kamen über „{label}“ an', p),
    text: (lang, p) => t(lang, 'Du findest sie im Ordner „{folder}“.', p),
    pref: 'mailUploads',
    action: 'Zum Ordner',
  },
  comment: {
    title: (lang, p) => t(lang, '{by} hat „{name}“ kommentiert', p),
    text: (_lang, p) => String(p.text ?? ''),
    pref: 'mailComments',
    action: 'Ansehen',
  },
  watch: {
    title: (lang, p) => (p.by ? t(lang, '{by} hat in „{folder}“ etwas geändert', p) : t(lang, 'In „{folder}“ hat sich etwas geändert', p)),
    text: (lang, p) => {
      const added = Number(p.added);
      const changed = Number(p.changed);
      const removed = Number(p.removed);
      if (added + changed + removed === 1) {
        return added ? t(lang, 'Neu: {name}', p) : changed ? t(lang, 'Geändert: {name}', p) : t(lang, 'Gelöscht: {name}', p);
      }
      return [
        added ? many(lang, added, 'Ein neues Element', '{count} neue Elemente', { count: added }) : '',
        changed ? many(lang, changed, 'Ein Element geändert', '{count} Elemente geändert', { count: changed }) : '',
        removed ? many(lang, removed, 'Ein Element gelöscht', '{count} Elemente gelöscht', { count: removed }) : '',
      ]
        .filter(Boolean)
        .join(', ');
    },
    pref: 'mailWatch',
    action: 'Zum Ordner',
  },
  virus: {
    title: (lang, p) => t(lang, '„{name}“ enthält Schadsoftware', p),
    text: (lang, p) => t(lang, 'Der Virenscan hat {signature} gefunden. Die Datei ist gesperrt, bis jemand sie löscht.', p),
    action: 'Ansehen',
  },
  storage: {
    title: (lang, p) => t(lang, 'Dein Speicher ist zu {percent} % voll', p),
    text: (lang) => t(lang, 'Lösch, was du nicht mehr brauchst, oder frag die Verwaltung nach mehr Platz.'),
    action: 'Speicher ansehen',
  },
  admin_user: {
    title: (lang, p) => t(lang, '{name} hat ein Konto erstellt', p),
    text: (lang, p) => t(lang, 'Benutzername: {username}', p),
    pref: 'mailAdmin',
    action: 'Zur Verwaltung',
    event: 'user_registered',
  },
  admin_virus: {
    title: (lang, p) => t(lang, 'Schadsoftware in „{name}“', p),
    text: (lang, p) => t(lang, 'Von {user}, gefunden wurde {signature}.', p),
    pref: 'mailAdmin',
    action: 'Zum Virenscan',
    event: 'virus',
  },
  admin_scan: {
    title: (lang) => t(lang, 'Der Virenscan ist nicht erreichbar'),
    text: (lang, p) => t(lang, String(p.error ?? '')),
    pref: 'mailAdmin',
    action: 'Zum Virenscan',
    event: 'scan_error',
  },
  admin_backup: {
    title: (lang) => t(lang, 'Die automatische Sicherung ist fehlgeschlagen'),
    text: (_lang, p) => String(p.error ?? ''),
    pref: 'mailAdmin',
    action: 'Zu den Sicherungen',
    event: 'backup_failed',
  },
  admin_disk: {
    title: (lang, p) => t(lang, 'Auf dem Server sind nur noch {free} frei', p),
    text: (lang) => t(lang, 'Ist die Platte voll, kann niemand mehr hochladen.'),
    pref: 'mailAdmin',
    action: 'Zur Übersicht',
    event: 'disk_low',
  },
  admin_update: {
    title: (lang, p) => t(lang, 'MoeCloud {version} ist erschienen', p),
    text: (lang, p) => (p.security ? t(lang, 'Diese Version schließt Sicherheitslücken.') : t(lang, 'Was neu ist, steht im Changelog.')),
    pref: 'mailAdmin',
    action: 'Zur Übersicht',
    event: 'update',
  },
  admin_logins: {
    title: (lang, p) => t(lang, '{count} fehlgeschlagene Anmeldungen in 15 Minuten', p),
    text: (lang) => t(lang, 'Im Protokoll siehst du, welche Konten betroffen sind.'),
    pref: 'mailAdmin',
    action: 'Zum Protokoll',
    event: 'login_failed',
  },
};

interface NotificationRow {
  id: number;
  user_id: number;
  kind: NotifyKind;
  params: string | null;
  url: string | null;
  read_at: number | null;
  created_at: number;
}

const absolute = (url: string) => {
  const base = settings.get('site.url').replace(/\/+$/, '');
  return base && url.startsWith('/') ? `${base}${url}` : url;
};

async function mail(user: UserRow, kind: NotifyKind, params: Params, url: string | null) {
  const spec = KINDS[kind];
  if (!user.email || user.disabled || !mailReady()) return;
  if (spec.pref && !prefsOf(user)[spec.pref]) return;
  const lang = preferredLanguage(user);
  const text = spec.text?.(lang, params);
  try {
    await deliver(user.email, {
      lang,
      title: spec.title(lang, params),
      lines: text ? [text] : [],
      action: url && spec.action && settings.get('site.url') ? { label: t(lang, spec.action), url: absolute(url) } : undefined,
      note: t(lang, 'Welche E-Mails du bekommst, stellst du unter Konto › Benachrichtigungen ein.'),
    });
  } catch (error) {
    log.warn({ error: (error as Error).message, kind }, 'E-Mail konnte nicht gesendet werden');
  }
}

export function notify(
  userId: number,
  kind: NotifyKind,
  params: Params = {},
  url: string | null = null,
  options: { email?: boolean } = {}
) {
  const user = getUser(userId);
  if (!user) return;
  const { lastId } = run(
    'INSERT INTO notifications (user_id, kind, params, url, created_at) VALUES (?, ?, ?, ?, ?)',
    userId,
    kind,
    JSON.stringify(params),
    url,
    Date.now()
  );
  publish([userId], 'notification', { id: lastId, unread: unreadCount(userId) });
  if (options.email !== false) void mail(user, kind, params, url);
}

const adminIds = () => all<{ id: number }>("SELECT id FROM users WHERE role = 'admin' AND disabled = 0").map((row) => row.id);

export function notifyAdmins(kind: NotifyKind, params: Params = {}, url: string | null = '/admin') {
  for (const id of adminIds()) notify(id, kind, params, url);
  const spec = KINDS[kind];
  if (!spec.event) return;
  const lang = settings.get('site.language');
  const text = spec.text?.(lang, params) ?? '';
  void dispatch({
    event: spec.event,
    title: spec.title(lang, params),
    text,
    level: ['admin_virus', 'admin_scan', 'admin_backup', 'admin_disk', 'admin_logins'].includes(kind) ? 'error' : 'info',
  }).catch(() => undefined);
}

export const unreadCount = (userId: number) =>
  value<number>('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', userId) ?? 0;

export function listNotifications(userId: number, lang: Lang, limit = 30) {
  return all<NotificationRow>('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit).map((row) => {
    const params = row.params ? (JSON.parse(row.params) as Params) : {};
    const spec = KINDS[row.kind];
    return {
      id: row.id,
      kind: row.kind,
      title: spec ? spec.title(lang, params) : row.kind,
      text: spec?.text?.(lang, params) ?? '',
      url: row.url,
      read: Boolean(row.read_at),
      createdAt: row.created_at,
    };
  });
}

export function markRead(userId: number, ids?: number[]) {
  const now = Date.now();
  if (ids?.length) {
    run(
      `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND id IN (${placeholders(ids.length)})`,
      now,
      userId,
      ...ids
    );
  } else {
    run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', now, userId);
  }
  publish([userId], 'notification', { unread: unreadCount(userId) });
}

export function clearNotifications(userId: number) {
  run('DELETE FROM notifications WHERE user_id = ?', userId);
  publish([userId], 'notification', { unread: 0 });
}

export function purgeNotifications() {
  return run(
    'DELETE FROM notifications WHERE created_at < ? OR (read_at IS NOT NULL AND read_at < ?)',
    Date.now() - 180 * 86_400_000,
    Date.now() - 30 * 86_400_000
  ).changes;
}
