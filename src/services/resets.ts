import type { FastifyRequest } from 'fastify';
import { one, run, value } from '../lib/db.ts';
import { hashPassword, randomId, sha256 } from '../lib/crypto.ts';
import { badRequest } from '../lib/errors.ts';
import { t } from '../lib/i18n.ts';
import { audit } from './audit.ts';
import { baseUrl } from './links.ts';
import { deliver, mailReady } from './mail.ts';
import { destroyUserSessions } from './sessions.ts';
import * as settings from './settings.ts';
import { findByLogin, getUser, preferredLanguage, type UserRow } from './users.ts';

interface ResetRow {
  id: string;
  user_id: number;
  token_hash: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

const HOUR = 60 * 60 * 1000;

async function issue(request: FastifyRequest, user: UserRow, hours: number, byAdmin: boolean) {
  const token = randomId(40);
  const now = Date.now();
  run(
    'INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    randomId(),
    user.id,
    sha256(token),
    now,
    now + hours * HOUR
  );
  const lang = preferredLanguage(user);
  const url = `${baseUrl(request)}/reset?token=${token}`;
  await deliver(user.email!, {
    lang,
    title: byAdmin
      ? t(lang, 'Leg ein Passwort für {site} fest', { site: settings.get('site.name') })
      : t(lang, 'Neues Passwort für {site}', { site: settings.get('site.name') }),
    lines: [
      t(lang, 'Hallo {name},', { name: user.name }),
      byAdmin
        ? t(lang, 'Die Verwaltung hat dir einen Link geschickt, mit dem du ein neues Passwort für dein Konto „{username}“ festlegst.', {
            username: user.username,
          })
        : t(lang, 'Jemand möchte das Passwort für dein Konto „{username}“ zurücksetzen. Warst du das, geht es hier weiter.', {
            username: user.username,
          }),
      hours === 1
        ? t(lang, 'Der Link gilt eine Stunde und funktioniert einmal.')
        : t(lang, 'Der Link gilt {hours} Stunden und funktioniert einmal.', { hours }),
    ],
    action: { label: t(lang, 'Passwort festlegen'), url },
    note: byAdmin ? undefined : t(lang, 'Warst du das nicht, kannst du diese E-Mail ignorieren. Dein Passwort bleibt, wie es ist.'),
  });
}

export async function requestReset(request: FastifyRequest, login: string) {
  if (!mailReady()) return;
  const user = findByLogin(login.trim());
  if (!user || !user.email || user.disabled) return;
  const recent =
    value<number>('SELECT COUNT(*) FROM password_resets WHERE user_id = ? AND created_at > ?', user.id, Date.now() - HOUR) ?? 0;
  if (recent >= 3) return;
  audit('password_reset_requested', { subject: user.id, request });
  await issue(request, user, 1, false);
}

export async function sendResetByAdmin(request: FastifyRequest, admin: UserRow, user: UserRow) {
  if (!mailReady()) throw badRequest('Richte zuerst den E-Mail-Versand ein');
  if (!user.email) throw badRequest('Für diese Person ist keine E-Mail-Adresse hinterlegt');
  audit('password_reset_requested', { actor: admin.id, subject: user.id, request });
  await issue(request, user, 24, true);
}

export function findReset(token: string | undefined) {
  if (!token || token.length > 80) return null;
  const row = one<ResetRow>('SELECT * FROM password_resets WHERE token_hash = ?', sha256(token));
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  const user = getUser(row.user_id);
  if (!user || user.disabled) return null;
  return { row, user };
}

export async function completeReset(request: FastifyRequest, token: string, password: string) {
  const found = findReset(token);
  if (!found) throw badRequest('Der Link ist abgelaufen oder wurde schon benutzt, fordere einen neuen an');
  const hash = await hashPassword(password);
  run('UPDATE users SET password_hash = ? WHERE id = ?', hash, found.user.id);
  run('UPDATE password_resets SET used_at = ? WHERE id = ?', Date.now(), found.row.id);
  run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', found.user.id);
  destroyUserSessions(found.user.id);
  audit('password_reset', { actor: found.user.id, request });
  return found.user;
}

export const purgeResets = () => run('DELETE FROM password_resets WHERE expires_at < ?', Date.now() - 7 * 86_400_000).changes;
