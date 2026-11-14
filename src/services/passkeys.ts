import type { FastifyRequest } from 'fastify';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { createHash } from 'node:crypto';
import { all, one, run } from '../lib/db.ts';
import { badRequest, notFound, unauthorized } from '../lib/errors.ts';
import * as settings from './settings.ts';
import { getUser, type UserRow } from './users.ts';

const webauthn = () => import('@simplewebauthn/server');

export interface PasskeyRow {
  id: string;
  user_id: number;
  public_key: Uint8Array;
  counter: number;
  transports: string | null;
  device_type: string | null;
  backed_up: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

const challenges = new Map<string, { challenge: string; expires: number }>();

function remember(key: string, challenge: string) {
  const now = Date.now();
  for (const [entry, value] of challenges) if (value.expires < now) challenges.delete(entry);
  challenges.set(key, { challenge, expires: now + 5 * 60 * 1000 });
}

function take(key: string) {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) throw badRequest('Die Anfrage ist abgelaufen, versuch es noch einmal');
  return entry.challenge;
}

export function relyingParty(request: FastifyRequest) {
  const configured = settings.get('site.url');
  const origin = configured ? new URL(configured).origin : `${request.protocol}://${request.host}`;
  return { origin, rpID: new URL(origin).hostname, name: settings.get('site.name') };
}

const userHandle = (user: UserRow) =>
  new Uint8Array(createHash('sha256').update(`${settings.secret()}:passkey:${user.id}`).digest().subarray(0, 32));

export const listPasskeys = (userId: number) => all<PasskeyRow>('SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at', userId);

export function presentPasskey(passkey: PasskeyRow) {
  return {
    id: passkey.id,
    name: passkey.name,
    synced: Boolean(passkey.backed_up),
    createdAt: passkey.created_at,
    lastUsedAt: passkey.last_used_at,
  };
}

export async function registrationOptions(request: FastifyRequest, user: UserRow, sessionId: string) {
  const rp = relyingParty(request);
  const { generateRegistrationOptions } = await webauthn();
  const options = await generateRegistrationOptions({
    rpName: rp.name,
    rpID: rp.rpID,
    userName: user.username,
    userDisplayName: user.name,
    userID: userHandle(user),
    attestationType: 'none',
    excludeCredentials: listPasskeys(user.id).map((passkey) => ({
      id: passkey.id,
      transports: passkey.transports ? (JSON.parse(passkey.transports) as string[]) : undefined,
    })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  remember(`register:${sessionId}`, options.challenge);
  return options;
}

export async function register(
  request: FastifyRequest,
  user: UserRow,
  sessionId: string,
  response: RegistrationResponseJSON,
  name: string
) {
  const rp = relyingParty(request);
  const expectedChallenge = take(`register:${sessionId}`);
  const { verifyRegistrationResponse } = await webauthn();
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch {
    throw badRequest('Der Passkey konnte nicht geprüft werden');
  }
  if (!verification.verified) throw badRequest('Der Passkey konnte nicht geprüft werden');
  const info = verification.registrationInfo;
  run(
    `INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    info.credential.id,
    user.id,
    info.credential.publicKey,
    info.credential.counter,
    info.credential.transports ? JSON.stringify(info.credential.transports) : null,
    info.credentialDeviceType,
    info.credentialBackedUp,
    name.trim().slice(0, 60) || 'Passkey',
    Date.now()
  );
  return one<PasskeyRow>('SELECT * FROM passkeys WHERE id = ?', info.credential.id)!;
}

export async function authenticationOptions(request: FastifyRequest, key: string, user?: UserRow) {
  const rp = relyingParty(request);
  const { generateAuthenticationOptions } = await webauthn();
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: user ? 'discouraged' : 'preferred',
    allowCredentials: user
      ? listPasskeys(user.id).map((passkey) => ({
          id: passkey.id,
          transports: passkey.transports ? (JSON.parse(passkey.transports) as string[]) : undefined,
        }))
      : undefined,
  });
  remember(`login:${key}`, options.challenge);
  return options;
}

export async function authenticate(request: FastifyRequest, key: string, response: AuthenticationResponseJSON) {
  const rp = relyingParty(request);
  const expectedChallenge = take(`login:${key}`);
  const passkey = one<PasskeyRow>('SELECT * FROM passkeys WHERE id = ?', response.id);
  if (!passkey) throw unauthorized('Diesen Passkey kennt der Server nicht');
  const { verifyAuthenticationResponse } = await webauthn();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: passkey.transports ? (JSON.parse(passkey.transports) as string[]) : undefined,
      },
      requireUserVerification: false,
    });
  } catch {
    throw unauthorized('Der Passkey konnte nicht geprüft werden');
  }
  if (!verification.verified) throw unauthorized('Der Passkey konnte nicht geprüft werden');
  run('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?', verification.authenticationInfo.newCounter, Date.now(), passkey.id);
  const user = getUser(passkey.user_id);
  if (!user || user.disabled) throw unauthorized('Dein Konto ist gesperrt, wende dich an die Verwaltung');
  return user;
}

export function renamePasskey(user: UserRow, id: string, name: string) {
  if (run('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?', name.trim().slice(0, 60) || 'Passkey', id, user.id).changes === 0) {
    throw notFound('Diesen Passkey gibt es nicht mehr');
  }
}

export function deletePasskey(user: UserRow, id: string) {
  if (run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', id, user.id).changes === 0)
    throw notFound('Diesen Passkey gibt es nicht mehr');
}
