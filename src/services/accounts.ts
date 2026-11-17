import type { FastifyRequest } from 'fastify';
import { all, run } from '../lib/db.ts';
import { verifyPassword } from '../lib/crypto.ts';
import { badRequest, forbidden } from '../lib/errors.ts';
import { audit } from './audit.ts';
import { notify, notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';
import { adminCount, deleteUser, keyOf, prefsOf, updatePrefs, type UserRow } from './users.ts';

const DAY = 24 * 60 * 60 * 1000;
export const EXPIRY_NOTICE = 7 * DAY;

export function remindExpiring(now = Date.now()) {
  const soon = all<UserRow>(
    'SELECT * FROM users WHERE disabled = 0 AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?',
    now,
    now + EXPIRY_NOTICE
  );
  let reminded = 0;
  for (const user of soon) {
    const at = Number(user.expires_at);
    if (prefsOf(user).expiryWarned === at) continue;
    updatePrefs(user.id, { expiryWarned: at });
    notify(user.id, 'account_expiring', { date: at }, '/account');
    reminded++;
  }
  const ended = run(
    'DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE expires_at IS NOT NULL AND expires_at <= ?)',
    now
  ).changes;
  return { reminded, ended };
}

export const selfDeleteAllowed = (user: UserRow) => settings.get('users.selfDelete') && !(user.role === 'admin' && adminCount() <= 1);

export async function deleteOwnAccount(request: FastifyRequest, user: UserRow, input: { password?: string; confirm: string }) {
  if (!settings.get('users.selfDelete')) throw forbidden('Das eigene Konto zu löschen ist hier ausgeschaltet');
  if (keyOf(input.confirm) !== user.username_key) throw badRequest('Gib zur Bestätigung deinen Benutzernamen ein');
  if (user.password_hash && !(input.password && (await verifyPassword(user.password_hash, input.password)))) {
    throw badRequest('Das Passwort stimmt nicht');
  }
  if (user.role === 'admin' && adminCount() <= 1) throw badRequest('Es muss immer mindestens einen Admin geben');
  deleteUser(user.id);
  audit('account_deleted', { request, details: { username: user.username, name: user.name } });
  notifyAdmins('admin_left', { name: user.name, username: user.username }, '/admin/people');
}
