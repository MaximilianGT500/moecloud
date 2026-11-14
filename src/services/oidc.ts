import { timingSafeEqual } from 'node:crypto';
import * as client from 'openid-client';
import { hmac, randomId } from '../lib/crypto.ts';
import { one, run } from '../lib/db.ts';
import { badRequest, forbidden, unauthorized } from '../lib/errors.ts';
import { log } from '../lib/log.ts';
import * as settings from './settings.ts';
import { createUser, getUser, keyOf, type UserRow } from './users.ts';

export interface Claims {
  sub: string;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  preferred_username?: unknown;
  groups?: unknown;
}

interface Pending {
  verifier: string;
  state: string;
  nonce: string;
  next: string;
  redirect: string;
  at: number;
}

const LIFETIME = 10 * 60 * 1000;
const DISCOVERY_TTL = 60 * 60 * 1000;

let cached: { key: string; config: client.Configuration; at: number } | null = null;

export const oidcEnabled = () =>
  settings.get('oidc.enabled') && Boolean(settings.get('oidc.issuer').trim() && settings.get('oidc.clientId').trim());

export const oidcLabel = (fallback: string) => settings.get('oidc.label').trim() || fallback;

function issuerUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest('Die Adresse des Anbieters ist ungültig');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Die Adresse des Anbieters muss mit https:// beginnen');
  return url;
}

export async function discover(issuer: string, clientId: string, secret: string) {
  const url = issuerUrl(issuer);
  const options: client.DiscoveryRequestOptions = { timeout: 10 };
  if (url.protocol === 'http:') options.execute = [client.allowInsecureRequests];
  return client.discovery(url, clientId.trim(), undefined, secret ? client.ClientSecretBasic(secret) : client.None(), options);
}

async function configuration() {
  const issuer = settings.get('oidc.issuer');
  const clientId = settings.get('oidc.clientId');
  const secret = settings.get('oidc.clientSecret');
  const key = hmac(settings.secret(), `${issuer}\n${clientId}\n${secret}`);
  if (cached?.key === key && Date.now() - cached.at < DISCOVERY_TTL) return cached.config;
  try {
    const config = await discover(issuer, clientId, secret);
    cached = { key, config, at: Date.now() };
    return config;
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Der Anbieter für die Anmeldung über SSO antwortet nicht');
    throw badRequest('Der Anbieter für die Anmeldung antwortet gerade nicht, versuch es später noch einmal');
  }
}

export const forgetDiscovery = () => {
  cached = null;
};

function seal(data: Pending) {
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${body}.${hmac(settings.secret(), `oidc:${body}`)}`;
}

function unseal(value: string | undefined): Pending | null {
  if (!value) return null;
  const [body, signature] = value.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(hmac(settings.secret(), `oidc:${body}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Pending;
    return Date.now() - data.at < LIFETIME ? data : null;
  } catch {
    return null;
  }
}

export async function beginLogin(redirect: string, next: string) {
  const config = await configuration();
  const verifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const supported = config.serverMetadata().scopes_supported;
  const scopes = ['openid', 'email', 'profile'];
  if (settings.get('oidc.adminGroup').trim() && supported?.includes('groups')) scopes.push('groups');
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirect,
    scope: scopes.join(' '),
    code_challenge: await client.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { url: url.href, cookie: seal({ verifier, state, nonce, next, redirect, at: Date.now() }) };
}

export async function finishLogin(query: string, cookie: string | undefined) {
  const pending = unseal(cookie);
  if (!pending) throw badRequest('Die Anmeldung ist abgelaufen, fang bitte noch einmal an');
  const config = await configuration();
  const current = new URL(pending.redirect);
  current.search = query;
  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: pending.verifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
      idTokenExpected: true,
    });
  } catch (error) {
    log.warn({ error: (error as Error).message }, 'Anmeldung über SSO fehlgeschlagen');
    throw unauthorized('Der Anbieter hat die Anmeldung nicht bestätigt, versuch es noch einmal');
  }
  let claims = { ...tokens.claims() } as Claims;
  if (tokens.access_token && (claims.email === undefined || (settings.get('oidc.adminGroup').trim() && claims.groups === undefined))) {
    try {
      const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
      claims = { ...info, ...claims, email: claims.email ?? info.email, groups: claims.groups ?? info.groups } as Claims;
    } catch (error) {
      log.debug({ error: (error as Error).message }, 'Userinfo des Anbieters nicht lesbar');
    }
  }
  return { claims, next: pending.next, subject: `${config.serverMetadata().issuer}#${claims.sub}` };
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function inGroup(claims: Claims) {
  const group = settings.get('oidc.adminGroup').trim();
  if (!group) return false;
  const groups = Array.isArray(claims.groups) ? claims.groups : typeof claims.groups === 'string' ? claims.groups.split(/[\s,]+/) : [];
  return groups.some((entry) => String(entry) === group);
}

function freeUsername(claims: Claims, email: string) {
  const candidates = [text(claims.preferred_username), email.split('@')[0] ?? '', text(claims.name)];
  let base = '';
  for (const candidate of candidates) {
    base = candidate
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '.')
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(0, 28);
    if (base.length >= 3) break;
  }
  if (base.length < 3) base = `sso-${randomId(6).toLowerCase()}`;
  for (let index = 1; index < 1000; index++) {
    const name = index === 1 ? base : `${base}${index}`;
    if (!one('SELECT 1 FROM users WHERE username_key = ?', keyOf(name))) return name;
  }
  return `${base.slice(0, 20)}-${randomId(6).toLowerCase()}`;
}

export async function userFor(subject: string, claims: Claims): Promise<{ user: UserRow; created: boolean; linked: boolean }> {
  const known = one<UserRow>('SELECT * FROM users WHERE oidc_sub = ?', subject);
  const email = claims.email_verified === true || claims.email_verified === 'true' ? text(claims.email) : '';
  let result: { user: UserRow; created: boolean; linked: boolean } | null = known ? { user: known, created: false, linked: false } : null;
  if (!result && email) {
    const existing = one<UserRow>('SELECT * FROM users WHERE email_key = ?', keyOf(email));
    if (existing && !existing.oidc_sub) {
      run('UPDATE users SET oidc_sub = ? WHERE id = ?', subject, existing.id);
      result = { user: getUser(existing.id)!, created: false, linked: true };
    }
  }
  if (!result) {
    if (!settings.get('oidc.autoCreate')) {
      throw forbidden('Für dieses Konto gibt es hier noch keinen Zugang. Frag die Verwaltung nach einer Einladung.');
    }
    const free = email && !one('SELECT 1 FROM users WHERE email_key = ?', keyOf(email)) ? email : null;
    const username = freeUsername(claims, email);
    const user = await createUser({
      username,
      name: text(claims.name).slice(0, 80) || username,
      email: free,
      password: null,
      role: inGroup(claims) ? 'admin' : 'user',
    });
    run('UPDATE users SET oidc_sub = ? WHERE id = ?', subject, user.id);
    result = { user: getUser(user.id)!, created: true, linked: false };
  }
  if (result.user.disabled) throw unauthorized('Dein Konto ist gesperrt, wende dich an die Verwaltung');
  if (!result.created && result.user.role !== 'admin' && inGroup(claims)) {
    run("UPDATE users SET role = 'admin' WHERE id = ?", result.user.id);
    result.user = getUser(result.user.id)!;
  }
  return result;
}

export function unlink(user: UserRow) {
  if (!user.password_hash) throw badRequest('Leg zuerst ein Passwort fest, sonst kommst du nicht mehr in dein Konto');
  run('UPDATE users SET oidc_sub = NULL WHERE id = ?', user.id);
}
