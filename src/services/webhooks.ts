import { createHmac, randomUUID } from 'node:crypto';
import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { checkUrl, request } from '../lib/fetch.ts';
import * as settings from './settings.ts';

export const WEBHOOK_KINDS = ['discord', 'slack', 'matrix', 'telegram', 'ntfy', 'json'] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];

export const WEBHOOK_EVENTS = [
  'user_registered',
  'virus',
  'scan_error',
  'backup_failed',
  'disk_low',
  'update',
  'login_failed',
  'test',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const FIELDS: Record<WebhookKind, { secret: string[]; plain: string[]; required: string[] }> = {
  discord: { secret: ['url'], plain: [], required: ['url'] },
  slack: { secret: ['url'], plain: [], required: ['url'] },
  matrix: { secret: ['token'], plain: ['homeserver', 'room'], required: ['token', 'homeserver', 'room'] },
  telegram: { secret: ['token'], plain: ['chatId'], required: ['token', 'chatId'] },
  ntfy: { secret: ['token'], plain: ['server', 'topic', 'priority'], required: ['topic'] },
  json: { secret: ['url', 'secret'], plain: [], required: ['url'] },
};

interface WebhookRow {
  id: string;
  name: string;
  kind: WebhookKind;
  config: string;
  events: string;
  enabled: number;
  created_at: number;
  last_at: number | null;
  last_status: number | null;
  last_error: string | null;
}

interface Target {
  id: string;
  name: string;
  kind: WebhookKind;
  config: Record<string, string>;
  events: WebhookEvent[];
  enabled: boolean;
}

export interface Note {
  event: WebhookEvent;
  title: string;
  text: string;
  level: 'info' | 'error';
}

function load(row: WebhookRow): Target {
  let config: Record<string, string> = {};
  let events: string[] = [];
  try {
    config = JSON.parse(row.config) as Record<string, string>;
    events = JSON.parse(row.events) as string[];
  } catch {}
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    config,
    events: events.filter((event): event is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(event)),
    enabled: Boolean(row.enabled),
  };
}

export function presentWebhook(row: WebhookRow) {
  const target = load(row);
  const fields = FIELDS[target.kind];
  return {
    id: target.id,
    name: target.name,
    kind: target.kind,
    events: target.events,
    enabled: target.enabled,
    config: Object.fromEntries(fields.plain.map((key) => [key, target.config[key] ?? ''])),
    secrets: Object.fromEntries(fields.secret.map((key) => [key, Boolean(target.config[key])])),
    createdAt: row.created_at,
    lastAt: row.last_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
  };
}

export const listWebhooks = () => all<WebhookRow>('SELECT * FROM webhooks ORDER BY created_at');
const getRow = (id: string) => one<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id);

export interface WebhookInput {
  name: string;
  kind: WebhookKind;
  events: WebhookEvent[];
  enabled: boolean;
  config: Record<string, string>;
}

function validate(kind: WebhookKind, config: Record<string, string>) {
  const fields = FIELDS[kind];
  for (const key of fields.required) if (!config[key]?.trim()) throw badRequest('Es fehlen Angaben für dieses Ziel');
  const urls = kind === 'matrix' ? [config.homeserver] : kind === 'ntfy' ? [config.server || 'https://ntfy.sh'] : [config.url];
  for (const value of urls.filter(Boolean)) {
    try {
      checkUrl(value);
    } catch {
      throw badRequest('Gib eine vollständige Adresse wie https://example.com ein');
    }
  }
  if (kind === 'discord' && !/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(config.url)) {
    throw badRequest('Das ist keine Webhook-Adresse von Discord');
  }
  if (kind === 'slack' && !/^https:\/\/hooks\.slack\.com\/[\w/-]+$/.test(config.url))
    throw badRequest('Das ist keine Webhook-Adresse von Slack');
  if (kind === 'ntfy' && !/^[\w-]{1,64}$/.test(config.topic ?? ''))
    throw badRequest('Das Thema darf nur Buchstaben, Ziffern, Minus und Unterstrich enthalten');
}

function merge(kind: WebhookKind, input: Record<string, string>, previous: Record<string, string> = {}) {
  const fields = FIELDS[kind];
  const out: Record<string, string> = {};
  for (const key of fields.plain) out[key] = String(input[key] ?? '').trim();
  for (const key of fields.secret) {
    const value = String(input[key] ?? '').trim();
    out[key] = value || previous[key] || '';
  }
  return out;
}

export function createWebhook(input: WebhookInput) {
  if (listWebhooks().length >= 20) throw badRequest('Mehr als 20 Ziele gehen nicht');
  const config = merge(input.kind, input.config);
  validate(input.kind, config);
  const id = randomId();
  run(
    'INSERT INTO webhooks (id, name, kind, config, events, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    input.name.trim() || input.kind,
    input.kind,
    JSON.stringify(config),
    JSON.stringify([...new Set(input.events)]),
    input.enabled,
    Date.now()
  );
  return getRow(id)!;
}

export function updateWebhook(id: string, input: WebhookInput) {
  const row = getRow(id);
  if (!row) throw notFound('Dieses Ziel gibt es nicht mehr');
  const previous = load(row);
  const config = merge(input.kind, input.config, previous.kind === input.kind ? previous.config : {});
  validate(input.kind, config);
  run(
    'UPDATE webhooks SET name = ?, kind = ?, config = ?, events = ?, enabled = ? WHERE id = ?',
    input.name.trim() || input.kind,
    input.kind,
    JSON.stringify(config),
    JSON.stringify([...new Set(input.events)]),
    input.enabled,
    id
  );
  return getRow(id)!;
}

export function deleteWebhook(id: string) {
  if (run('DELETE FROM webhooks WHERE id = ?', id).changes === 0) throw notFound('Dieses Ziel gibt es nicht mehr');
}

const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1');
const escape = (text: string) => text.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
const markup = (text: string) =>
  escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');

async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const result = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    timeout: 8000,
  });
  if (!result.ok) throw Object.assign(new Error(`HTTP ${result.status}`), { status: result.status });
  return result.status;
}

const SENDERS: Record<WebhookKind, (target: Target, note: Note) => Promise<number>> = {
  discord: (target, note) =>
    post(target.config.url, {
      username: settings.get('site.name'),
      embeds: [
        {
          title: note.title,
          description: note.text.slice(0, 2000),
          color: note.level === 'error' ? 0xd63d60 : 0x059669,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  slack: (target, note) => post(target.config.url, { text: `*${note.title}*\n${note.text.replace(/\*\*(.+?)\*\*/g, '*$1*')}` }),
  telegram: (target, note) =>
    post(`https://api.telegram.org/bot${encodeURIComponent(target.config.token)}/sendMessage`, {
      chat_id: target.config.chatId,
      text: `<b>${escape(note.title)}</b>\n${escape(note.text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  matrix: async (target, note) => {
    const base = target.config.homeserver.replace(/\/+$/, '');
    const result = await request(
      `${base}/_matrix/client/v3/rooms/${encodeURIComponent(target.config.room)}/send/m.room.message/${randomUUID()}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.config.token}` },
        body: JSON.stringify({
          msgtype: 'm.notice',
          body: `${note.title}\n${plain(note.text)}`,
          format: 'org.matrix.custom.html',
          formatted_body: `<strong>${escape(note.title)}</strong><br>${markup(note.text)}`,
        }),
      }
    );
    if (!result.ok) throw Object.assign(new Error(`HTTP ${result.status}`), { status: result.status });
    return result.status;
  },
  ntfy: async (target, note) => {
    const server = (target.config.server || 'https://ntfy.sh').replace(/\/+$/, '');
    const priority = ['1', '2', '3', '4', '5'].includes(target.config.priority)
      ? target.config.priority
      : note.level === 'error'
        ? '4'
        : '3';
    const result = await request(`${server}/${encodeURIComponent(target.config.topic)}`, {
      method: 'POST',
      headers: {
        Title: encodeURIComponent(note.title),
        Priority: priority,
        Tags: note.level === 'error' ? 'warning' : 'cloud',
        'Content-Type': 'text/plain; charset=utf-8',
        ...(target.config.token ? { Authorization: `Bearer ${target.config.token}` } : {}),
      },
      body: plain(note.text),
    });
    if (!result.ok) throw Object.assign(new Error(`HTTP ${result.status}`), { status: result.status });
    return result.status;
  },
  json: (target, note) => {
    const body = JSON.stringify({
      event: note.event,
      level: note.level,
      title: note.title,
      text: plain(note.text),
      site: settings.get('site.name'),
      at: new Date().toISOString(),
    });
    const signature = target.config.secret ? `sha256=${createHmac('sha256', target.config.secret).update(body).digest('hex')}` : '';
    return post(target.config.url, JSON.parse(body), signature ? { 'X-MoeCloud-Signature': signature } : {});
  },
};

async function deliver(target: Target, note: Note) {
  try {
    const status = await SENDERS[target.kind](target, note);
    run('UPDATE webhooks SET last_at = ?, last_status = ?, last_error = NULL WHERE id = ?', Date.now(), status, target.id);
    return { ok: true as const, status };
  } catch (error) {
    const status = (error as { status?: number }).status ?? 0;
    const message = (error as Error).name === 'TimeoutError' ? 'Zeitüberschreitung' : (error as Error).message.slice(0, 300);
    run('UPDATE webhooks SET last_at = ?, last_status = ?, last_error = ? WHERE id = ?', Date.now(), status, message, target.id);
    return { ok: false as const, status, error: message };
  }
}

export function dispatch(note: Note) {
  const targets = listWebhooks()
    .map(load)
    .filter((target) => target.enabled && target.events.includes(note.event));
  return Promise.all(targets.map((target) => deliver(target, note)));
}

export async function testWebhook(id: string, note: Note) {
  const row = getRow(id);
  if (!row) throw notFound('Dieses Ziel gibt es nicht mehr');
  return deliver(load(row), note);
}
