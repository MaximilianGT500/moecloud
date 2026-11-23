import { formatBytes } from '../../lib/format';
import { t, tn } from '../../lib/i18n';

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
    case 'email_changed':
      return t('E-Mail-Adresse geändert');
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
    case 'account_secured':
      return t('Konto abgesichert');
    case 'lockout_released':
      return t('Sperre aufgehoben');
    case 'sso_unlinked':
      return t('SSO-Verbindung getrennt');
    case 'account_exported':
      return t('Daten exportiert');
    case 'account_deleted':
      return t('Konto selbst gelöscht');
    case 'users_imported':
      return t('Personen importiert');
    case 'registered':
      return t('Konto erstellt');
    case 'user_created':
      return t('Person angelegt');
    case 'user_updated':
      return t('Person geändert');
    case 'user_approved':
      return t('Konto freigegeben');
    case 'email_confirmed':
      return t('E-Mail-Adresse bestätigt');
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
    case 'files_recovered':
      return t('Dateien wiederhergestellt');
    case 'invite_created':
      return t('Einladung erstellt');
    case 'invite_deleted':
      return t('Einladung gelöscht');
    case 'settings_changed':
      return t('Einstellungen geändert');
    case 'audit_exported':
      return t('Protokoll als CSV geladen');
    case 'integrity_checked':
      return t('Dateien geprüft');
    case 'device_burst':
      return t('Auffällig viele Änderungen über ein App-Passwort');
    case 'device_resumed':
      return t('Angehaltenes App-Passwort freigegeben');
    case 'mail_changed':
      return t('E-Mail-Versand geändert');
    case 'sso_changed':
      return t('Anmeldung über SSO geändert');
    case 'scan_changed':
      return t('Virenscan geändert');
    case 'webhook_changed':
      return t('Webhook geändert');
    case 'link_removed':
      return t('Link entfernt');
    case 'theme_saved':
      return t('Theme gespeichert');
    case 'theme_deleted':
      return t('Theme gelöscht');
    case 'plugin_enabled':
      return t('Plugin eingeschaltet');
    case 'plugin_disabled':
      return t('Plugin ausgeschaltet');
    case 'plugin_settings':
      return t('Plugin eingestellt');
    case 'plugin_installed':
      return t('Plugin installiert');
    case 'plugin_removed':
      return t('Plugin entfernt');
    case 'plugin_stopped':
      return t('Plugin angehalten');
    case 'link_reported':
      return t('Link gemeldet');
    case 'report_resolved':
      return t('Meldung erledigt');
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
    case 'group_created':
      return t('Gruppe angelegt');
    case 'group_updated':
      return t('Gruppe geändert');
    case 'group_deleted':
      return t('Gruppe gelöscht');
    case 'terms_accepted':
      return t('Nutzungsbedingungen zugestimmt');
    case 'team_created':
      return t('Teamordner angelegt');
    case 'team_updated':
      return t('Teamordner geändert');
    case 'team_deleted':
      return t('Teamordner gelöscht');
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
        case 'oidc':
          return t('SSO');
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
    case 'device_burst':
      return [
        text('appPassword'),
        typeof d.count === 'number' ? tn(d.count, '{count} Änderung', '{count} Änderungen') : '',
        d.paused ? t('angehalten') : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'device_resumed':
      return text('appPassword');
    case 'audit_exported':
      return typeof d.rows === 'number' ? tn(d.rows, '{count} Zeile', '{count} Zeilen') : '';
    case 'integrity_checked':
      return [
        typeof d.checked === 'number' ? tn(d.checked, '{count} Datei', '{count} Dateien') : '',
        Number(d.missing) + Number(d.damaged) > 0 ? t('{count} nicht in Ordnung', { count: Number(d.missing) + Number(d.damaged) }) : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'virus_found':
      return [text('name'), text('signature')].filter(Boolean).join(' · ');
    case 'virus_released':
    case 'virus_deleted':
      return text('signature');
    case 'user_deleted':
      return [text('username') && `@${text('username')}`, text('transfer') && t('Dateien an @{name}', { name: text('transfer') })]
        .filter(Boolean)
        .join(' · ');
    case 'account_deleted':
      return text('username') ? `@${text('username')}` : '';
    case 'role_changed':
    case 'user_created':
      return d.role === 'admin' ? t('Admin') : d.role === 'user' ? t('Mitglied') : '';
    case 'files_transferred':
      return [text('from') && `@${text('from')}`, text('folder')].filter(Boolean).join(' → ');
    case 'files_recovered':
      return [
        typeof d.count === 'number' ? tn(d.count, '{count} Datei', '{count} Dateien') : '',
        typeof d.size === 'number' ? formatBytes(d.size) : '',
        text('folder'),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'maintenance':
      return d.enabled ? t('eingeschaltet') : t('ausgeschaltet');
    case 'webhook_changed':
    case 'group_created':
    case 'group_deleted':
      return text('name');
    case 'team_created':
      return text('name');
    case 'team_deleted':
      return [text('name'), typeof d.files === 'number' ? tn(d.files, '{count} Datei', '{count} Dateien') : ''].filter(Boolean).join(' · ');
    case 'team_updated':
    case 'group_updated':
      return [
        text('before') ? `${text('before')} → ${text('name')}` : text('name'),
        Array.isArray(d.added) && d.added.length ? `+ ${(d.added as string[]).join(', ')}` : '',
        Array.isArray(d.removed) && d.removed.length ? `− ${(d.removed as string[]).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    case 'link_removed':
    case 'link_reported':
    case 'report_resolved':
      return text('label');
    case 'theme_saved':
    case 'theme_deleted':
    case 'plugin_enabled':
    case 'plugin_disabled':
    case 'plugin_settings':
    case 'plugin_installed':
    case 'plugin_removed':
      return text('name');
    case 'plugin_stopped':
      return [
        text('name'),
        d.reason === 'changed'
          ? t('Dateien geändert')
          : d.reason === 'failed'
            ? t('Start misslungen')
            : d.reason === 'missing'
              ? t('Ordner fehlt')
              : t('Ordner nicht lesbar'),
      ]
        .filter(Boolean)
        .join(' · ');
    case 'invite_created':
      return d.email ? t('per E-Mail') : '';
    case 'admin_2fa_reset':
      return [
        typeof d.passkeys !== 'number' || d.totp ? t('Authenticator-App') : '',
        typeof d.passkeys === 'number' ? tn(d.passkeys, 'ein Passkey entfernt', '{count} Passkeys entfernt') : '',
      ]
        .filter(Boolean)
        .join(' · ');
    default:
      return Array.isArray(d.keys) ? (d.keys as string[]).join(', ') : Array.isArray(d.fields) ? (d.fields as string[]).join(', ') : '';
  }
}
