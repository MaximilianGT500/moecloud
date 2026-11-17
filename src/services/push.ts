import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { config } from '../config.ts';
import { badRequest, forbidden } from '../lib/errors.ts';
import { guardedLookup, privateLiteral } from '../lib/netguard.ts';
import * as settings from './settings.ts';
import type { PushTarget } from './users.ts';

const TIMEOUT = 8000;
const allowPrivate = () => settings.get('push.private');
const lookup = guardedLookup(allowPrivate);

export interface PushMessage {
  title: string;
  text: string;
  url?: string | null;
}

export function pushUrl(kind: PushTarget['kind'], input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw badRequest('Die Adresse sieht nicht richtig aus');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw badRequest('Nur Adressen mit http:// oder https:// gehen');
  if (url.username || url.password) throw badRequest('Zugangsdaten gehören nicht in die Adresse');
  if (kind === 'ntfy' && !url.pathname.split('/').some(Boolean)) {
    throw badRequest('Gib die Adresse mit Thema an, etwa https://ntfy.sh/mein-thema');
  }
  if (!allowPrivate() && privateLiteral(url)) throw forbidden('Adressen im lokalen Netz sind für Push gesperrt');
  url.hash = '';
  url.search = '';
  return url;
}

function post(url: URL, body: string, headers: Record<string, string>) {
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<number>((resolve, reject) => {
    const request = send(
      url,
      {
        method: 'POST',
        lookup,
        timeout: TIMEOUT,
        headers: {
          'user-agent': `MoeCloud/${config.version}`,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          ...headers,
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }
    );
    request.on('timeout', () => request.destroy(Object.assign(new Error('Zeitüberschreitung'), { code: 'MOE_TIMEOUT' })));
    request.on('error', reject);
    request.end(body);
  });
}

async function deliver(url: URL, body: string, headers: Record<string, string>) {
  let status: number;
  try {
    status = await post(url, body, headers);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MOE_PRIVATE') throw forbidden('Adressen im lokalen Netz sind für Push gesperrt');
    throw badRequest('Der Push-Dienst ist nicht erreichbar');
  }
  if (status === 401 || status === 403) throw badRequest('Der Push-Dienst lehnt den Token ab');
  if (status < 200 || status >= 300) throw badRequest('Der Push-Dienst hat mit {status} geantwortet', { status });
}

export async function sendPush(target: PushTarget, message: PushMessage) {
  const base = pushUrl(target.kind, target.url);
  const text = message.text || message.title;
  if (target.kind === 'ntfy') {
    const segments = base.pathname.split('/').filter(Boolean);
    const topic = decodeURIComponent(segments.pop()!);
    const root = new URL(base.href);
    root.pathname = `/${segments.join('/')}`;
    const payload = { topic, title: message.title, message: text, tags: ['cloud'], ...(message.url ? { click: message.url } : {}) };
    return deliver(root, JSON.stringify(payload), target.token ? { authorization: `Bearer ${target.token}` } : {});
  }
  if (!target.token) throw badRequest('Gotify braucht einen App-Token');
  const endpoint = new URL(base.href);
  endpoint.pathname = `${endpoint.pathname.replace(/\/+$/, '')}/message`;
  const payload = {
    title: message.title,
    message: text,
    priority: 5,
    ...(message.url ? { extras: { 'client::notification': { click: { url: message.url } } } } : {}),
  };
  return deliver(endpoint, JSON.stringify(payload), { 'x-gotify-key': target.token });
}
