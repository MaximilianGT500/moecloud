import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { generateRequestDetails, generateVAPIDKeys } from 'web-push';
import { deviceOf } from '../lib/agent.ts';
import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import type { Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { guardedLookup, privateLiteral } from '../lib/netguard.ts';
import type { PushMessage } from './push.ts';
import * as settings from './settings.ts';
import type { UserRow } from './users.ts';

interface SubscriptionRow {
  id: string;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  agent: string | null;
  origin: string | null;
  created_at: number;
  used_at: number | null;
}

const MAX_PER_USER = 20;
const TIMEOUT = 8000;
const allowPrivate = () => settings.get('push.private');
const lookup = guardedLookup(allowPrivate);

export function vapidKeys() {
  let keys = settings.get('push.vapid');
  if (!keys) {
    keys = generateVAPIDKeys();
    settings.set('push.vapid', keys);
  }
  return keys;
}

function endpointUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw badRequest('Die Adresse des Push-Dienstes sieht nicht richtig aus');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowPrivate())) {
    throw badRequest('Die Adresse des Push-Dienstes sieht nicht richtig aus');
  }
  if (!allowPrivate() && privateLiteral(url)) throw forbidden('Adressen im lokalen Netz sind für Push gesperrt');
  return url;
}

export const hasSubscriptions = (userId: number) =>
  Boolean(one('SELECT 1 AS found FROM push_subscriptions WHERE user_id = ? LIMIT 1', userId));

export function listSubscriptions(user: UserRow, lang: Lang, current?: string | null) {
  return all<SubscriptionRow>('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC', user.id).map((row) => ({
    id: row.id,
    device: deviceOf(lang, row.agent),
    createdAt: Number(row.created_at),
    usedAt: row.used_at === null ? null : Number(row.used_at),
    current: Boolean(current && row.endpoint === current),
  }));
}

export function saveSubscription(
  user: UserRow,
  input: { endpoint: string; keys: { p256dh: string; auth: string } },
  context: { agent?: string | null; origin?: string | null }
) {
  if (!settings.get('push.enabled')) throw forbidden('Push ist auf diesem Server ausgeschaltet');
  const endpoint = endpointUrl(input.endpoint).href;
  const existing = one<SubscriptionRow>('SELECT * FROM push_subscriptions WHERE endpoint = ?', endpoint);
  if (
    !existing &&
    Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', user.id)?.n ?? 0) >= MAX_PER_USER
  ) {
    throw badRequest('Du hast Push schon in sehr vielen Browsern eingeschaltet, entfern erst ein paar');
  }
  const id = existing?.id ?? randomId();
  run(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, agent, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       agent = excluded.agent, origin = excluded.origin`,
    id,
    user.id,
    endpoint,
    input.keys.p256dh,
    input.keys.auth,
    context.agent?.slice(0, 300) ?? null,
    context.origin ?? null,
    Date.now()
  );
  return id;
}

export function removeSubscription(user: UserRow, id: string) {
  const { changes } = run('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?', id, user.id);
  if (!changes) throw notFound('Diesen Browser gibt es hier nicht mehr');
}

function subject(row: SubscriptionRow) {
  for (const candidate of [settings.get('site.url'), row.origin ?? '']) {
    if (/^https:\/\/[^/]+/i.test(candidate) && !/^https:\/\/localhost\b/i.test(candidate)) return candidate;
  }
  const from = settings.get('mail.from');
  return /^[^@\s]+@[^@\s]+$/.test(from) ? `mailto:${from}` : 'https://moecloud.moestudio.net';
}

function post(url: URL, headers: Record<string, string | number>, body: Buffer | null) {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<number>((resolve, reject) => {
    const request = send(url, { method: 'POST', lookup, timeout: TIMEOUT, headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'MOE_TIMEOUT' })));
    request.on('error', reject);
    request.end(body ?? undefined);
  });
}

async function deliver(row: SubscriptionRow, message: PushMessage) {
  const keys = vapidKeys();
  const details = generateRequestDetails(
    { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
    JSON.stringify({ title: message.title, text: message.text, url: message.url ?? null }),
    {
      vapidDetails: { subject: subject(row), publicKey: keys.publicKey, privateKey: keys.privateKey },
      TTL: 24 * 60 * 60,
      urgency: 'normal',
    }
  );
  const status = await post(endpointUrl(row.endpoint), details.headers as Record<string, string | number>, details.body as Buffer | null);
  if (status === 404 || status === 410) {
    run('DELETE FROM push_subscriptions WHERE id = ?', row.id);
    return false;
  }
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  run('UPDATE push_subscriptions SET used_at = ? WHERE id = ?', Date.now(), row.id);
  return true;
}

export async function sendWebPush(userId: number, message: PushMessage) {
  if (!settings.get('push.enabled')) return 0;
  const rows = all<SubscriptionRow>('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  let sent = 0;
  for (const row of rows) {
    try {
      if (await deliver(row, message)) sent += 1;
    } catch (error) {
      log.warn({ error: (error as Error).message, user: userId }, 'Push an den Browser konnte nicht zugestellt werden');
    }
  }
  return sent;
}

export const SERVICE_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'MoeCloud', {
      body: data.text || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/files' },
    })
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/files', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && 'focus' in client) {
          return client.focus().then((focused) => ('navigate' in focused ? focused.navigate(target.href) : undefined));
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
`;
