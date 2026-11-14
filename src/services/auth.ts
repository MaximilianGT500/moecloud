import type { FastifyRequest } from 'fastify';
import { one, run, tx, value } from '../lib/db.ts';
import { hmac, newTotpSecret, normalizeRecoveryCode, randomId, recoveryCode, verifyPassword, verifyTotp } from '../lib/crypto.ts';
import { badRequest, unauthorized } from '../lib/errors.ts';
import { Limiter } from '../lib/limiter.ts';
import * as settings from './settings.ts';
import { findByLogin, getUser, keyOf, type UserRow } from './users.ts';

export const secondFactorRequired = (user: Pick<UserRow, 'role'>, policy = settings.get('auth.require2fa')) =>
  policy === 'all' || (policy === 'admins' && user.role === 'admin');

export const passkeyCount = (userId: number) => value<number>('SELECT COUNT(*) FROM passkeys WHERE user_id = ?', userId) ?? 0;

export const hasPasskey = (user: UserRow) => settings.get('auth.passkeys') && passkeyCount(user.id) > 0;

export const hasSecondFactor = (user: UserRow) => Boolean(user.totp_enabled) || hasPasskey(user);

const ssoOnly = (user: UserRow) => Boolean(user.oidc_sub) && !user.password_hash;

export const needsSecondFactor = (user: UserRow) => secondFactorRequired(user) && !hasSecondFactor(user) && !ssoOnly(user);

export const secondFactorPending = (user: UserRow, method?: string | null) => method !== 'oidc' && needsSecondFactor(user);

const perIp = new Limiter(30, 15 * 60 * 1000);
const perAccount = new Limiter(10, 15 * 60 * 1000);
const secondFactor = new Limiter(10, 15 * 60 * 1000);

export function loginBlocked(request: FastifyRequest, login: string) {
  return perIp.blocked(`ip:${request.ip}`) || perAccount.blocked(`login:${keyOf(login)}`);
}

export async function passwordLogin(request: FastifyRequest, login: string, password: string): Promise<UserRow> {
  const ipKey = `ip:${request.ip}`;
  const accountKey = `login:${keyOf(login)}`;
  perIp.check(ipKey);
  perAccount.check(accountKey);
  const user = findByLogin(login);
  const valid = await verifyPassword(user?.password_hash, password);
  if (!user || !valid) {
    perIp.hit(ipKey);
    perAccount.hit(accountKey);
    throw unauthorized('Benutzername oder Passwort stimmt nicht');
  }
  if (user.disabled) throw unauthorized('Dein Konto ist gesperrt, wende dich an die Verwaltung');
  perAccount.reset(accountKey);
  return user;
}

interface Pending {
  userId: number;
  expires: number;
  method: string;
}

const pending = new Map<string, Pending>();

export function startSecondFactor(user: UserRow, method: string) {
  const token = randomId(32);
  const now = Date.now();
  for (const [key, entry] of pending) if (entry.expires < now) pending.delete(key);
  pending.set(token, { userId: user.id, expires: now + 5 * 60 * 1000, method });
  return token;
}

export function pendingUser(token: string | undefined) {
  if (!token) return null;
  const entry = pending.get(token);
  if (!entry || entry.expires < Date.now()) return null;
  const user = getUser(entry.userId);
  return user && !user.disabled ? { user, method: entry.method } : null;
}

export const finishSecondFactor = (token: string) => pending.delete(token);

const recoveryHash = (code: string) => hmac(settings.secret(), `recovery:${normalizeRecoveryCode(code)}`);

export function verifySecondFactor(request: FastifyRequest, user: UserRow, code: string): boolean {
  const key = `2fa:${user.id}`;
  secondFactor.check(key);
  secondFactor.check(`2fa-ip:${request.ip}`);
  const ok = checkSecondFactor(user, code);
  if (!ok) {
    secondFactor.hit(key);
    secondFactor.hit(`2fa-ip:${request.ip}`);
  }
  return ok;
}

function checkSecondFactor(user: UserRow, code: string): boolean {
  const clean = code.replace(/\s+/g, '');
  if (/^\d{6}$/.test(clean)) {
    if (!user.totp_secret) return false;
    const counter = verifyTotp(user.totp_secret, clean, user.totp_last);
    if (counter === null) return false;
    run('UPDATE users SET totp_last = ? WHERE id = ?', counter, user.id);
    return true;
  }
  if (normalizeRecoveryCode(clean).length !== 10) return false;
  const row = one<{ id: number }>(
    'SELECT id FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
    user.id,
    recoveryHash(clean)
  );
  if (!row) return false;
  run('UPDATE recovery_codes SET used_at = ? WHERE id = ?', Date.now(), row.id);
  return true;
}

export function newRecoveryCodes(userId: number): string[] {
  const codes = Array.from({ length: 10 }, recoveryCode);
  tx(() => {
    run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
    for (const code of codes) run('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)', userId, recoveryHash(code));
  });
  return codes;
}

export const remainingRecoveryCodes = (userId: number) =>
  one<{ count: number }>('SELECT COUNT(*) AS count FROM recovery_codes WHERE user_id = ? AND used_at IS NULL', userId)?.count ?? 0;

export function beginTotp(user: UserRow) {
  if (user.totp_enabled) throw badRequest('Die Authenticator-App ist schon eingerichtet');
  const secret = newTotpSecret();
  run('UPDATE users SET totp_secret = ? WHERE id = ?', secret, user.id);
  const issuer = settings.get('site.name');
  const label = encodeURIComponent(`${issuer}:${user.username}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri };
}

export function enableTotp(user: UserRow, code: string) {
  if (user.totp_enabled) throw badRequest('Die Authenticator-App ist schon eingerichtet');
  if (!user.totp_secret) throw badRequest('Starte die Einrichtung noch einmal');
  const counter = verifyTotp(user.totp_secret, code, 0);
  if (counter === null) throw badRequest('Der Code stimmt nicht, prüf die Uhrzeit auf deinem Gerät');
  run('UPDATE users SET totp_enabled = 1, totp_last = ? WHERE id = ?', counter, user.id);
  return newRecoveryCodes(user.id);
}

export function disableTotp(request: FastifyRequest, user: UserRow, code: string) {
  if (!user.totp_enabled) return;
  if (secondFactorRequired(user) && !hasPasskey(user)) {
    throw badRequest('Die Verwaltung verlangt einen zweiten Faktor. Richte zuerst einen Passkey ein, dann kannst du die App entfernen.');
  }
  if (!verifySecondFactor(request, user, code)) throw badRequest('Der Code stimmt nicht');
  resetTotp(user.id);
}

export function resetTotp(userId: number) {
  tx(() => {
    run('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last = 0 WHERE id = ?', userId);
    run('DELETE FROM recovery_codes WHERE user_id = ?', userId);
  });
}
