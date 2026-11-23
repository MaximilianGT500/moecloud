import { deviceOf } from '../lib/agent.ts';
import { all, one, placeholders, run, value } from '../lib/db.ts';
import { publish } from '../lib/events.ts';
import { longDate, sizeIn, t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { deliver, mailReady } from './mail.ts';
import { sendPush, type PushMessage } from './push.ts';
import { hasSubscriptions, sendWebPush } from './webpush.ts';
import * as settings from './settings.ts';
import { ACTIVE, getUser, inactive, preferredLanguage, prefsOf, type UserPrefs, type UserRow } from './users.ts';
import { dispatch, type WebhookEvent } from './webhooks.ts';

export type NotifyKind =
  | 'shared'
  | 'team_added'
  | 'team_storage'
  | 'automation'
  | 'request_upload'
  | 'form_response'
  | 'comment'
  | 'mention'
  | 'reminder'
  | 'plugin'
  | 'watch'
  | 'virus'
  | 'storage'
  | 'import_done'
  | 'import_failed'
  | 'dav_import_done'
  | 'dav_import_partial'
  | 'dav_import_failed'
  | 'login_new'
  | 'account_change'
  | 'device_burst'
  | 'cleanup'
  | 'account_expiring'
  | 'lock_removed'
  | 'link_download'
  | 'link_expiring'
  | 'admin_user'
  | 'admin_pending'
  | 'admin_inactive'
  | 'admin_left'
  | 'admin_storage'
  | 'admin_report'
  | 'admin_virus'
  | 'admin_scan'
  | 'admin_backup'
  | 'admin_disk'
  | 'admin_integrity'
  | 'admin_burst'
  | 'admin_update'
  | 'admin_logins'
  | 'admin_plugin';

type Params = Record<string, string | number>;

interface Kind {
  title: (lang: Lang, params: Params) => string;
  text?: (lang: Lang, params: Params) => string;
  pref?: keyof UserPrefs;
  action?: string;
  event?: WebhookEvent;
  urgent?: boolean;
}

const many = (lang: Lang, count: number, one: string, other: string, params: Params) => t(lang, count === 1 ? one : other, params);

function reportReason(lang: Lang, reason: string) {
  if (reason === 'illegal') return t(lang, 'Verbotene Inhalte');
  if (reason === 'malware') return t(lang, 'Schadsoftware oder Betrug');
  if (reason === 'copyright') return t(lang, 'Urheberrecht');
  if (reason === 'privacy') return t(lang, 'Persönliche Daten');
  return t(lang, 'Sonstiges');
}

function changeTitle(lang: Lang, params: Params) {
  switch (params.change) {
    case 'password':
      return t(lang, 'Dein Passwort wurde geändert');
    case 'email':
      return t(lang, 'Die E-Mail-Adresse deines Kontos wurde geändert');
    case 'totp_off':
      return t(lang, 'Die Authenticator-App wurde ausgeschaltet');
    case 'totp_on':
      return t(lang, 'Die Authenticator-App wurde eingerichtet');
    case 'passkey_added':
      return t(lang, 'Ein Passkey wurde hinzugefügt');
    case 'passkey_removed':
      return t(lang, 'Ein Passkey wurde entfernt');
    case 'app_password':
      return t(lang, 'Das App-Passwort „{name}“ wurde erstellt', params);
    case 'app_password_admin':
      return t(lang, 'Das App-Passwort „{name}“ mit Zugriff auf die Verwaltung wurde erstellt', params);
    case 'secured':
      return t(lang, 'Dein Konto wurde abgesichert');
    default:
      return t(lang, 'An deinem Konto wurde etwas geändert');
  }
}

const KINDS: Record<NotifyKind, Kind> = {
  shared: {
    title: (lang, p) =>
      p.group ? t(lang, '{by} hat „{name}“ mit der Gruppe {group} geteilt', p) : t(lang, '{by} hat „{name}“ mit dir geteilt', p),
    text: (lang, p) =>
      [
        p.note ? t(lang, 'Notiz: {note}', p) : '',
        p.permission === 'edit'
          ? t(lang, 'Du kannst den Inhalt ansehen und bearbeiten.')
          : t(lang, 'Du kannst den Inhalt ansehen und herunterladen.'),
      ]
        .filter(Boolean)
        .join(' '),
    pref: 'mailShares',
    action: 'Ansehen',
  },
  team_added: {
    title: (lang, p) => t(lang, '{by} hat dich in den Teamordner „{name}“ aufgenommen', p),
    text: (lang) => t(lang, 'Du findest ihn in der Navigation unter Teamordner.'),
    pref: 'mailShares',
    action: 'Ansehen',
  },
  team_storage: {
    title: (lang, p) => t(lang, 'Der Teamordner „{name}“ ist zu {percent} % voll', p),
    text: (lang) => t(lang, 'Räum darin auf oder gib dem Teamordner in der Verwaltung mehr Platz.'),
    action: 'Ansehen',
  },
  automation: {
    title: (lang, p) => t(lang, 'Ablauf „{rule}“ hat „{name}“ bearbeitet', p),
    pref: 'mailUploads',
    action: 'Ansehen',
  },
  request_upload: {
    title: (lang, p) => many(lang, Number(p.count), 'Eine Datei kam über „{label}“ an', '{count} Dateien kamen über „{label}“ an', p),
    text: (lang, p) => t(lang, 'Du findest sie im Ordner „{folder}“.', p),
    pref: 'mailUploads',
    action: 'Zum Ordner',
  },
  device_burst: {
    urgent: true,
    title: (lang, p) => (Number(p.paused) ? t(lang, '„{name}“ ist angehalten', p) : t(lang, 'Auffällig viele Änderungen über „{name}“', p)),
    text: (lang, p) =>
      Number(p.paused)
        ? t(
            lang,
            'Über dieses App-Passwort kamen in wenigen Minuten {count} Änderungen. Bis du es wieder freigibst, kann es nur noch lesen. Warst du das nicht, setz deine Dateien auf den Stand davor zurück.',
            p
          )
        : t(
            lang,
            'Über dieses App-Passwort kamen in wenigen Minuten {count} Änderungen. Warst du das nicht, widerruf es und setz deine Dateien auf den Stand davor zurück.',
            p
          ),
    action: 'Ansehen',
  },
  form_response: {
    title: (lang, p) => many(lang, Number(p.count), 'Eine neue Antwort auf „{title}“', '{count} neue Antworten auf „{title}“', p),
    pref: 'mailUploads',
    action: 'Antworten ansehen',
  },
  comment: {
    title: (lang, p) => t(lang, '{by} hat „{name}“ kommentiert', p),
    text: (_lang, p) => String(p.text ?? ''),
    pref: 'mailComments',
    action: 'Ansehen',
  },
  reminder: {
    title: (lang, p) => t(lang, 'Erinnerung: „{name}“', p),
    text: (lang, p) => String(p.note || t(lang, 'Du wolltest an diese Datei erinnert werden.')),
    pref: 'mailReminders',
    action: 'Ansehen',
  },
  plugin: {
    title: (_lang, p) => String(p.title ?? ''),
    text: (_lang, p) => String(p.text ?? ''),
    pref: 'mailPlugins',
    action: 'Ansehen',
  },
  mention: {
    title: (lang, p) => t(lang, '{by} hat dich in einem Kommentar zu „{name}“ erwähnt', p),
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
    urgent: true,
    title: (lang, p) => t(lang, '„{name}“ enthält Schadsoftware', p),
    text: (lang, p) => t(lang, 'Der Virenscan hat {signature} gefunden. Die Datei ist gesperrt, bis jemand sie löscht.', p),
    action: 'Ansehen',
  },
  storage: {
    title: (lang, p) => t(lang, 'Dein Speicher ist zu {percent} % voll', p),
    text: (lang) => t(lang, 'Lösch, was du nicht mehr brauchst, oder frag die Verwaltung nach mehr Platz.'),
    action: 'Speicher ansehen',
  },
  import_done: {
    title: (lang, p) => t(lang, '„{name}“ ist fertig geladen', p),
    text: (lang) => t(lang, 'Der Download aus dem Internet liegt jetzt in deinen Dateien.'),
    action: 'Zum Ordner',
  },
  import_failed: {
    title: (lang, p) => t(lang, 'Der Download von {host} hat nicht geklappt', p),
    text: (_lang, p) => String(p.error ?? ''),
  },
  dav_import_done: {
    title: (lang, p) => t(lang, 'Der Import von {host} ist fertig', p),
    text: (lang, p) =>
      many(lang, Number(p.files), 'Eine Datei liegt jetzt in „{folder}“.', '{files} Dateien liegen jetzt in „{folder}“.', p),
    action: 'Zum Ordner',
  },
  dav_import_partial: {
    title: (lang, p) => t(lang, 'Der Import von {host} ist fertig, aber nicht vollständig', p),
    text: (lang, p) => t(lang, 'Geholt: {files}, nicht geholt: {failed}. Was fehlt, steht im Fenster „Per WebDAV importieren“.', p),
    action: 'Zum Ordner',
  },
  dav_import_failed: {
    title: (lang, p) => t(lang, 'Der Import von {host} hat nicht geklappt', p),
    text: (_lang, p) => String(p.error ?? ''),
    action: 'Zum Ordner',
  },
  login_new: {
    urgent: true,
    title: (lang) => t(lang, 'Neue Anmeldung bei deinem Konto'),
    text: (lang, p) =>
      t(
        lang,
        '{device} mit der IP-Adresse {ip}. Warst du das nicht, ändere dein Passwort und melde das Gerät unter Konto › Sitzungen ab.',
        {
          device: deviceOf(lang, String(p.agent ?? '')),
          ip: p.ip,
        }
      ),
    pref: 'mailLogins',
    action: 'Sitzungen ansehen',
  },
  account_change: {
    urgent: true,
    title: (lang, p) => changeTitle(lang, p),
    text: (lang) => t(lang, 'Warst du das nicht, ändere sofort dein Passwort und sieh unter Konto › Sitzungen nach, wer angemeldet ist.'),
    action: 'Sitzungen ansehen',
  },
  cleanup: {
    title: (lang, p) => many(lang, Number(p.count), 'Eine Datei aus „{folder}“ aufgeräumt', '{count} Dateien aus „{folder}“ aufgeräumt', p),
    text: (lang, p) => t(lang, 'Sie lagen länger als {days} Tage unverändert dort. Im Papierkorb kannst du sie wiederherstellen.', p),
    action: 'Zum Papierkorb',
  },
  admin_user: {
    title: (lang, p) => t(lang, '{name} hat ein Konto erstellt', p),
    text: (lang, p) => t(lang, 'Benutzername: {username}', p),
    pref: 'mailAdmin',
    action: 'Zur Verwaltung',
    event: 'user_registered',
  },
  admin_pending: {
    title: (lang, p) => t(lang, '{name} wartet auf die Freigabe', p),
    text: (lang, p) => t(lang, 'Benutzername: {username}', p),
    pref: 'mailAdmin',
    action: 'Zur Verwaltung',
  },
  admin_inactive: {
    title: (lang, p) =>
      many(
        lang,
        Number(p.count),
        'Ein Konto nach {days} Tagen ohne Nutzung gesperrt',
        '{count} Konten nach {days} Tagen ohne Nutzung gesperrt',
        p
      ),
    text: (lang, p) => t(lang, 'Betroffen: {names}. Unter Personen hebst du die Sperre wieder auf.', p),
    pref: 'mailAdmin',
    action: 'Zur Verwaltung',
  },
  admin_virus: {
    urgent: true,
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
  account_expiring: {
    title: (lang) => t(lang, 'Dein Konto läuft bald ab'),
    text: (lang, p) =>
      t(
        lang,
        'Ab {date} kannst du dich nicht mehr anmelden. Lade vorher herunter, was du behalten willst, oder frag die Verwaltung nach mehr Zeit.',
        {
          date: longDate(lang, Number(p.date)),
        }
      ),
    action: 'Zum Konto',
  },
  link_download: {
    title: (lang, p) => t(lang, '„{name}“ wurde über deinen Link heruntergeladen', p),
    text: (lang, p) =>
      t(lang, 'Downloads über diesen Link bisher: {count}. Weitere Downloads meldet MoeCloud höchstens einmal pro Stunde.', p),
    pref: 'mailShares',
    action: 'Ansehen',
  },
  link_expiring: {
    title: (lang, p) => t(lang, 'Dein Link zu „{name}“ läuft bald ab', p),
    text: (lang, p) =>
      t(
        lang,
        'Ab {date} kommt niemand mehr über den Link an den Inhalt. Brauchst du ihn länger, stell im Teilen-Fenster ein neues Datum ein.',
        {
          date: longDate(lang, Number(p.date)),
        }
      ),
    pref: 'mailShares',
    action: 'Ansehen',
  },
  lock_removed: {
    title: (lang, p) => t(lang, '{name} hat deine Sperre für „{file}“ gelöst', p),
    text: (lang) => t(lang, 'Andere können die Datei jetzt wieder ändern.'),
    pref: 'mailShares',
    action: 'Ansehen',
  },
  admin_report: {
    title: (lang, p) => t(lang, 'Jemand hat den Link „{label}“ gemeldet', p),
    text: (lang, p) =>
      t(lang, 'Grund: {reason}. Der Link gehört {owner}.', { reason: reportReason(lang, String(p.reason)), owner: String(p.owner) }),
    pref: 'mailAdmin',
    action: 'Zu den Links',
  },
  admin_left: {
    title: (lang, p) => t(lang, '{name} hat das eigene Konto gelöscht', p),
    text: (lang, p) => t(lang, 'Benutzername: {username}', p),
    pref: 'mailAdmin',
    action: 'Zu den Personen',
  },
  admin_storage: {
    title: (lang, p) => t(lang, '{name} fragt nach mehr Speicher', p),
    text: (lang, p) =>
      [
        t(lang, '{used} von {quota} belegt.', { used: sizeIn(lang, Number(p.used)), quota: sizeIn(lang, Number(p.quota)) }),
        p.message ? t(lang, 'Nachricht: {message}', p) : '',
      ]
        .filter(Boolean)
        .join(' '),
    pref: 'mailAdmin',
    action: 'Zu den Personen',
  },
  admin_backup: {
    urgent: true,
    title: (lang) => t(lang, 'Die automatische Sicherung ist fehlgeschlagen'),
    text: (_lang, p) => String(p.error ?? ''),
    pref: 'mailAdmin',
    action: 'Zu den Sicherungen',
    event: 'backup_failed',
  },
  admin_disk: {
    urgent: true,
    title: (lang, p) => t(lang, 'Auf dem Server sind nur noch {free} frei', p),
    text: (lang) => t(lang, 'Ist die Platte voll, kann niemand mehr hochladen.'),
    pref: 'mailAdmin',
    action: 'Zur Übersicht',
    event: 'disk_low',
  },
  admin_burst: {
    urgent: true,
    title: (lang, p) =>
      Number(p.paused) ? t(lang, 'Ein Gerät von {user} wurde angehalten', p) : t(lang, 'Auffällig viele Änderungen bei {user}', p),
    text: (lang, p) =>
      t(lang, 'Über das App-Passwort „{name}“ kamen in wenigen Minuten {count} Änderungen, Umbenennungen oder Löschungen.', p),
    pref: 'mailAdmin',
    action: 'Zum Protokoll',
    event: 'changes_burst',
  },
  admin_integrity: {
    urgent: true,
    title: (lang) => t(lang, 'Bei der Prüfung der Dateien ist etwas aufgefallen'),
    text: (lang, p) => t(lang, 'Fehlende Dateien: {missing}, beschädigte Dateien: {damaged}.', p),
    pref: 'mailAdmin',
    action: 'Zur Sicherheit',
    event: 'files_damaged',
  },
  admin_update: {
    title: (lang, p) => t(lang, 'MoeCloud {version} ist erschienen', p),
    text: (lang, p) => (p.security ? t(lang, 'Diese Version schließt Sicherheitslücken.') : t(lang, 'Was neu ist, steht im Changelog.')),
    pref: 'mailAdmin',
    action: 'Zur Übersicht',
    event: 'update',
  },
  admin_logins: {
    urgent: true,
    title: (lang, p) => t(lang, '{count} fehlgeschlagene Anmeldungen in 15 Minuten', p),
    text: (lang) => t(lang, 'Im Protokoll siehst du, welche Konten betroffen sind.'),
    pref: 'mailAdmin',
    action: 'Zum Protokoll',
    event: 'login_failed',
  },
  admin_plugin: {
    urgent: true,
    title: (lang, p) => t(lang, 'Das Plugin „{name}“ steht still', p),
    text: (lang, p) =>
      p.reason === 'changed'
        ? t(lang, 'Seine Dateien haben sich seit der Freigabe geändert. Schau sie dir an und gib das Plugin neu frei.')
        : p.reason === 'failed'
          ? t(lang, 'Der Start ist misslungen: {error}', p)
          : p.reason === 'missing'
            ? t(lang, 'Sein Ordner fehlt auf dem Server.')
            : t(lang, 'Sein Ordner lässt sich nicht mehr lesen: {error}', p),
    pref: 'mailAdmin',
    action: 'Zu den Plugins',
    event: 'plugin_stopped',
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

export function localClock(zone: string, now = Date.now()) {
  let parts: Intl.DateTimeFormatPart[];
  const options = { hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' } as const;
  try {
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone || 'UTC' }).formatToParts(new Date(now));
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).formatToParts(new Date(now));
  }
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  return {
    minutes: (Number(part('hour')) % 24) * 60 + Number(part('minute')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday')),
  };
}

export const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

export function inQuiet(prefs: Pick<UserPrefs, 'quiet' | 'zone'>, now = Date.now()) {
  const quiet = prefs.quiet;
  if (!quiet || quiet.from === quiet.to) return false;
  const { minutes } = localClock(prefs.zone, now);
  return quiet.from < quiet.to ? minutes >= quiet.from && minutes < quiet.to : minutes >= quiet.from || minutes < quiet.to;
}

const DIGEST_MINUTE = 8 * 60;

export function digestCutoff(prefs: Pick<UserPrefs, 'digest' | 'zone'>, now = Date.now()) {
  if (prefs.digest === 'off') return now;
  const clock = localClock(prefs.zone, now);
  let since = clock.minutes - DIGEST_MINUTE;
  if (prefs.digest === 'weekly') {
    since += ((clock.weekday + 6) % 7) * 24 * 60;
    if (since < 0) since += 7 * 24 * 60;
  } else if (since < 0) since += 24 * 60;
  return now - since * 60_000;
}

const wantsMail = (user: UserRow, spec: Kind) =>
  Boolean(user.email) && !inactive(user) && mailReady() && !(spec.pref && !prefsOf(user)[spec.pref]);

const canPush = (user: UserRow) =>
  !inactive(user) && settings.get('push.enabled') && (Boolean(prefsOf(user).push) || hasSubscriptions(user.id));

const wantsPush = (user: UserRow, spec: Kind) => canPush(user) && !(spec.pref && !prefsOf(user)[spec.pref]);

async function sendPushes(user: UserRow, message: PushMessage, kind: string) {
  const target = prefsOf(user).push;
  if (target) {
    try {
      await sendPush(target, message);
    } catch (error) {
      log.warn({ error: (error as Error).message, user: user.id, kind }, 'Push konnte nicht zugestellt werden');
    }
  }
  await sendWebPush(user.id, message);
}

async function push(user: UserRow, kind: NotifyKind, params: Params, url: string | null) {
  const spec = KINDS[kind];
  if (!wantsPush(user, spec)) return;
  const lang = preferredLanguage(user);
  await sendPushes(
    user,
    { title: spec.title(lang, params), text: spec.text?.(lang, params) ?? '', url: url && settings.get('site.url') ? absolute(url) : url },
    kind
  );
}

async function mail(user: UserRow, kind: NotifyKind, params: Params, url: string | null) {
  const spec = KINDS[kind];
  if (!wantsMail(user, spec)) return;
  const lang = preferredLanguage(user);
  const text = spec.text?.(lang, params);
  try {
    await deliver(user.email!, {
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

export function notifyMerged(userId: number, kind: NotifyKind, params: Params, url: string, windowMs = 60 * 60 * 1000) {
  const now = Date.now();
  const open = one<{ id: number; params: string | null }>(
    'SELECT id, params FROM notifications WHERE user_id = ? AND kind = ? AND url = ? AND read_at IS NULL AND created_at > ? ORDER BY id DESC LIMIT 1',
    userId,
    kind,
    url,
    now - windowMs
  );
  if (!open) return notify(userId, kind, { ...params, count: 1 }, url);
  const previous = open.params ? (JSON.parse(open.params) as Params) : {};
  run(
    'UPDATE notifications SET params = ?, created_at = ? WHERE id = ?',
    JSON.stringify({ ...previous, ...params, count: Number(previous.count ?? 1) + 1 }),
    now,
    open.id
  );
  publish([userId], 'notification', { id: open.id, unread: unreadCount(userId) });
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
  const spec = KINDS[kind];
  const now = Date.now();
  const outside = options.email !== false;
  const prefs = prefsOf(user);
  const quiet = outside && !spec.urgent && inQuiet(prefs, now);
  const mailWanted = outside && wantsMail(user, spec);
  const pushWanted = outside && wantsPush(user, spec);
  const mailHeld = mailWanted && (quiet || (!spec.urgent && prefs.digest !== 'off'));
  const pushHeld = pushWanted && quiet;
  const { lastId } = run(
    'INSERT INTO notifications (user_id, kind, params, url, created_at, mail_state, push_state) VALUES (?, ?, ?, ?, ?, ?, ?)',
    userId,
    kind,
    JSON.stringify(params),
    url,
    now,
    mailHeld ? 1 : 0,
    pushHeld ? 1 : 0
  );
  publish([userId], 'notification', { id: lastId, unread: unreadCount(userId) });
  if (mailWanted && !mailHeld) void mail(user, kind, params, url);
  if (pushWanted && !pushHeld) void push(user, kind, params, url);
}

const SUMMARY_LINES = 15;

async function mailSummary(user: UserRow, rows: NotificationRow[]) {
  if (!user.email || !mailReady()) return;
  const lang = preferredLanguage(user);
  const titles = rows.map((row) => KINDS[row.kind].title(lang, row.params ? (JSON.parse(row.params) as Params) : {}));
  const site = settings.get('site.name');
  const more = titles.length - SUMMARY_LINES;
  try {
    await deliver(user.email, {
      lang,
      title: many(lang, titles.length, 'Eine Neuigkeit in {site}', '{count} Neuigkeiten in {site}', { count: titles.length, site }),
      lines: [
        ...titles.slice(0, SUMMARY_LINES).map((title) => `• ${title}`),
        ...(more > 0 ? [many(lang, more, '… und eine weitere', '… und {count} weitere', { count: more })] : []),
      ],
      action: settings.get('site.url') ? { label: t(lang, 'Ansehen'), url: absolute('/files') } : undefined,
      note: t(lang, 'Welche E-Mails du bekommst, stellst du unter Konto › Benachrichtigungen ein.'),
    });
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Zusammenfassung konnte nicht gesendet werden');
  }
}

async function pushSummary(user: UserRow, rows: NotificationRow[]) {
  const lang = preferredLanguage(user);
  const titles = rows.map((row) => KINDS[row.kind].title(lang, row.params ? (JSON.parse(row.params) as Params) : {}));
  await sendPushes(
    user,
    {
      title: t(lang, '{count} neue Benachrichtigungen', { count: titles.length }),
      text: titles.slice(0, 3).join('\n'),
      url: settings.get('site.url') ? absolute('/files') : '/files',
    },
    'summary'
  );
}

const paramsOf = (row: NotificationRow) => (row.params ? (JSON.parse(row.params) as Params) : {});

export async function flushSummaries(now = Date.now()) {
  const waiting = all<{ user_id: number }>('SELECT DISTINCT user_id FROM notifications WHERE mail_state = 1 OR push_state = 1');
  let sent = 0;
  for (const { user_id: userId } of waiting) {
    const user = getUser(userId);
    if (!user || inactive(user)) {
      run('UPDATE notifications SET mail_state = 0, push_state = 0 WHERE user_id = ?', userId);
      continue;
    }
    const prefs = prefsOf(user);
    if (inQuiet(prefs, now)) continue;
    const pushed = all<NotificationRow>('SELECT * FROM notifications WHERE user_id = ? AND push_state = 1 ORDER BY id', userId);
    if (pushed.length) {
      run('UPDATE notifications SET push_state = 0 WHERE user_id = ? AND push_state = 1 AND id <= ?', userId, pushed.at(-1)!.id);
      const unread = pushed.filter((row) => !row.read_at);
      if (unread.length === 1) await push(user, unread[0].kind, paramsOf(unread[0]), unread[0].url);
      else if (unread.length > 1 && canPush(user)) await pushSummary(user, unread);
      if (unread.length) sent += 1;
    }
    const mailed = all<NotificationRow>(
      'SELECT * FROM notifications WHERE user_id = ? AND mail_state = 1 AND created_at <= ? ORDER BY id',
      userId,
      digestCutoff(prefs, now)
    );
    if (mailed.length) {
      run(`UPDATE notifications SET mail_state = 0 WHERE id IN (${placeholders(mailed.length)})`, ...mailed.map((row) => row.id));
      const unread = mailed.filter((row) => !row.read_at);
      if (unread.length === 1) await mail(user, unread[0].kind, paramsOf(unread[0]), unread[0].url);
      else if (unread.length > 1) await mailSummary(user, unread);
      if (unread.length) sent += 1;
    }
  }
  return sent;
}

const adminIds = () => all<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' AND ${ACTIVE}`, Date.now()).map((row) => row.id);

export function notifyAdmins(kind: NotifyKind, params: Params = {}, url: string | null = '/admin', except?: number) {
  for (const id of adminIds()) if (id !== except) notify(id, kind, params, url);
  const spec = KINDS[kind];
  if (!spec.event) return;
  const lang = settings.get('site.language');
  const text = spec.text?.(lang, params) ?? '';
  void dispatch({
    event: spec.event,
    title: spec.title(lang, params),
    text,
    level: [
      'admin_virus',
      'admin_scan',
      'admin_backup',
      'admin_disk',
      'admin_integrity',
      'admin_burst',
      'admin_logins',
      'admin_plugin',
    ].includes(kind)
      ? 'error'
      : 'info',
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
