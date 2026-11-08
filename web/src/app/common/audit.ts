import { formatBytes } from '../../lib/format';
import { t } from '../../lib/i18n';

export interface AuditEntry {
  id: number;
  action: string;
  actor: { id: number; name: string; username: string } | null;
  subject: { id: number; name: string; username: string } | null;
  ip: string | null;
  details: Record<string, unknown> | null;
  createdAt: number;
}

export const FAILED_ACTIONS = new Set(['login_failed', 'virus_found', 'backup_failed']);

export function auditLabel(action: string) {
  switch (action) {
    case 'login':
      return t('Anmeldung');
    case 'login_failed':
      return t('Anmeldung fehlgeschlagen');
    case 'logout':
      return t('Abmeldung');
    case 'password_changed':
      return t('Passwort geändert');
    case 'password_reset_requested':
      return t('Neues Passwort angefordert');
    case 'password_reset':
      return t('Passwort zurückgesetzt');
    case 'totp_enabled':
      return t('Authenticator-App eingeschaltet');
    case 'totp_disabled':
      return t('Authenticator-App ausgeschaltet');
    case 'recovery_codes':
      return t('Neue Wiederherstellungscodes');
    case 'passkey_added':
      return t('Passkey hinzugefügt');
    case 'passkey_removed':
      return t('Passkey entfernt');
    case 'app_password_created':
      return t('App-Passwort erstellt');
    case 'app_password_removed':
      return t('App-Passwort widerrufen');
    case 'sessions_revoked':
      return t('Andere Geräte abgemeldet');
    case 'registered':
      return t('Konto erstellt');
    case 'user_created':
      return t('Person angelegt');
    case 'user_updated':
      return t('Person geändert');
    case 'user_deleted':
      return t('Person gelöscht');
    case 'user_disabled':
      return t('Konto gesperrt');
    case 'user_enabled':
      return t('Konto entsperrt');
    case 'role_changed':
      return t('Rolle geändert');
    case 'admin_password_set':
      return t('Passwort von der Verwaltung gesetzt');
    case 'admin_2fa_reset':
      return t('Zweiten Faktor zurückgesetzt');
    case 'admin_logout':
      return t('Von der Verwaltung abgemeldet');
    case 'files_transferred':
      return t('Dateien übertragen');
    case 'invite_created':
      return t('Einladung erstellt');
    case 'invite_deleted':
      return t('Einladung gelöscht');
    case 'settings_changed':
      return t('Einstellungen geändert');
    case 'mail_changed':
      return t('E-Mail-Versand geändert');
    case 'scan_changed':
      return t('Virenscan geändert');
    case 'webhook_changed':
      return t('Webhook geändert');
    case 'link_removed':
      return t('Link entfernt');
    case 'virus_found':
      return t('Schadsoftware gefunden');
    case 'virus_released':
      return t('Gesperrte Datei freigegeben');
    case 'virus_deleted':
      return t('Befallene Datei gelöscht');
    case 'backup_created':
      return t('Sicherung erstellt');
    case 'backup_deleted':
      return t('Sicherung gelöscht');
    case 'backup_failed':
      return t('Sicherung fehlgeschlagen');
    case 'maintenance':
      return t('Wartungsmodus');
    default:
      return action;
  }
}

function method(value: unknown) {
  return String(value ?? '')
    .split(/[+,]/)
    .filter(Boolean)
    .map((part) => {
      switch (part) {
        case 'password':
          return t('Passwort');
        case 'passkey':
          return t('Passkey');
        case 'totp':
          return t('Authenticator-App');
        case 'recovery':
          return t('Wiederherstellungscode');
        case '2fa':
          return t('Zweiter Faktor');
        default:
          return part;
      }
    })
    .join(' + ');
}

export function auditDetail(entry: AuditEntry) {
  const d = entry.details ?? {};
  const text = (key: string) => (d[key] === undefined || d[key] === null || d[key] === '' ? '' : String(d[key]));
  switch (entry.action) {
    case 'login':
      return method(d.method);
    case 'login_failed':
      return [text('login') && `„${text('login')}“`, method(d.method)].filter(Boolean).join(' · ');
    case 'passkey_added':
    case 'app_password_created':
    case 'backup_deleted':
      return text('name');
    case 'backup_created':
      return [text('name'), typeof d.size === 'number' ? formatBytes(d.size) : ''].filter(Boolean).join(' · ');
    case 'backup_failed':
      return text('error');
    case 'virus_found':
      return [text('name'), text('signature')].filter(Boolean).join(' · ');
    case 'virus_released':
    case 'virus_deleted':
      return text('signature');
    case 'user_deleted':
      return [text('username') && `@${text('username')}`, text('transfer') && t('Dateien an @{name}', { name: text('transfer') })]
        .filter(Boolean)
        .join(' · ');
    case 'role_changed':
    case 'user_created':
      return d.role === 'admin' ? t('Admin') : d.role === 'user' ? t('Mitglied') : '';
    case 'files_transferred':
      return [text('from') && `@${text('from')}`, text('folder')].filter(Boolean).join(' → ');
    case 'maintenance':
      return d.enabled ? t('eingeschaltet') : t('ausgeschaltet');
    case 'webhook_changed':
      return text('name');
    case 'link_removed':
      return text('label');
    case 'invite_created':
      return d.email ? t('per E-Mail') : '';
    default:
      return Array.isArray(d.keys) ? (d.keys as string[]).join(', ') : Array.isArray(d.fields) ? (d.fields as string[]).join(', ') : '';
  }
}
