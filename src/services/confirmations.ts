import type { FastifyRequest } from 'fastify';
import { all, one, run } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { t } from '../lib/i18n.ts';
import { mailBase } from './origins.ts';
import { deliver, mailReady } from './mail.ts';
import * as settings from './settings.ts';
import { deleteUser, getUser, preferredLanguage, type UserRow } from './users.ts';

export const PENDING_APPROVAL = 1;
export const PENDING_EMAIL = 2;

const HOURS = 48;
const LIFETIME = HOURS * 60 * 60 * 1000;
const RESEND_GAP = 5 * 60 * 1000;

const DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const parseDomains = (text: string) => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[\s,;]+/)
      .map((entry) => entry.replace(/^@/, '').trim())
      .filter(Boolean)
  ),
];

export const validDomains = (text: string) => {
  const list = parseDomains(text);
  return list.length <= 50 && list.every((entry) => DOMAIN.test(entry));
};

export const cleanDomains = (text: string) => parseDomains(text).join(', ');

export const allowedDomains = () => parseDomains(settings.get('auth.domains'));

export const confirmationWanted = () => settings.get('auth.confirmEmail') || allowedDomains().length > 0;

export function domainAllowed(email: string) {
  const domains = allowedDomains();
  if (!domains.length) return true;
  const domain = email.toLowerCase().split('@').pop() ?? '';
  return domains.includes(domain);
}

export async function sendConfirmation(request: FastifyRequest, user: UserRow) {
  if (!user.email || !mailReady()) return false;
  const now = Date.now();
  const latest = one<{ created_at: number }>(
    'SELECT created_at FROM email_confirmations WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    user.id
  );
  if (latest && now - Number(latest.created_at) < RESEND_GAP) return false;
  const token = randomId(40);
  run('DELETE FROM email_confirmations WHERE user_id = ?', user.id);
  run(
    'INSERT INTO email_confirmations (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token),
    user.id,
    now,
    now + LIFETIME
  );
  const lang = preferredLanguage(user);
  const site = settings.get('site.name');
  await deliver(user.email, {
    lang,
    title: t(lang, 'Bestätige deine E-Mail-Adresse für {site}', { site }),
    lines: [
      t(lang, 'Hallo {name},', { name: user.name }),
      t(lang, 'du hast bei {site} das Konto „{username}“ angelegt. Bestätige deine E-Mail-Adresse, dann geht es weiter.', {
        site,
        username: user.username,
      }),
      t(lang, 'Der Link gilt {hours} Stunden.', { hours: HOURS }),
    ],
    action: { label: t(lang, 'E-Mail-Adresse bestätigen'), url: `${mailBase(request)}/register/confirm?token=${token}` },
    note: t(lang, 'Hast du kein Konto angelegt, kannst du diese E-Mail ignorieren. Das Konto wird dann von selbst gelöscht.'),
  });
  return true;
}

export function confirmEmail(token: string, now = Date.now()) {
  if (!/^[0-9A-Za-z_-]{20,80}$/.test(token)) return null;
  const row = one<{ user_id: number; expires_at: number }>(
    'SELECT user_id, expires_at FROM email_confirmations WHERE token_hash = ?',
    sha256(token)
  );
  if (!row || Number(row.expires_at) <= now) return null;
  const user = getUser(Number(row.user_id));
  if (!user) return null;
  run('DELETE FROM email_confirmations WHERE user_id = ?', user.id);
  if (!(Number(user.pending) & PENDING_EMAIL)) return { user, changed: false };
  run('UPDATE users SET pending = ? WHERE id = ?', Number(user.pending) & ~PENDING_EMAIL, user.id);
  return { user: getUser(user.id)!, changed: true };
}

export function purgeUnconfirmed(now = Date.now()) {
  run('DELETE FROM email_confirmations WHERE expires_at < ?', now);
  const stale = all<UserRow>(
    `SELECT u.* FROM users u
     WHERE u.pending >= ${PENDING_EMAIL} AND u.created_at < ? AND u.last_login_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM email_confirmations c WHERE c.user_id = u.id)`,
    now - LIFETIME
  ).filter((user) => Number(user.pending) & PENDING_EMAIL);
  for (const user of stale) deleteUser(user.id);
  return stale.length;
}
