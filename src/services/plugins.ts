import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { config } from '../config.ts';
import { all, one, run } from '../lib/db.ts';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors.ts';
import { checkUrl, userAgent } from '../lib/fetch.ts';
import { setHooks } from '../lib/hooks.ts';
import type { Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { guardedLookup, privateLiteral } from '../lib/netguard.ts';
import { blobPath } from './blobs.ts';
import { children, createFolder, requireAccess, requireFolder, type NodeRow } from './nodes.ts';
import { audit } from './audit.ts';
import { notify, notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';
import { specSchema } from './themes.ts';
import { uploadStream } from './uploads.ts';
import { getUser, listUsers, type UserRow } from './users.ts';

export const PLUGIN_API = 1;
const MAX_FILES = 5000;
const MAX_BYTES = 128 * 1024 * 1024;
const SETUP_TIMEOUT = 10_000;
const DEV_WATCH = 1500;
const FILTER_TIMEOUT = 10_000;
const ROUTE_TIMEOUT = 60_000;
const MIN_INTERVAL = 10_000;

export const PLUGIN_ICONS = [
  'extension',
  'bolt',
  'chart',
  'send',
  'label',
  'print',
  'cloud',
  'star',
  'build',
  'image',
  'document',
  'lock',
  'download',
  'share',
  'schedule',
  'code',
] as const;

export const PLUGIN_PERMISSIONS = ['network', 'files', 'users', 'notify'] as const;
type Permission = (typeof PLUGIN_PERMISSIONS)[number];

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
const text = (max: number) => z.string().trim().min(1).max(max);
const localized = (max: number) => z.union([text(max), z.object({ de: text(max), en: text(max).optional() })]);
type Localized = z.infer<ReturnType<typeof localized>>;

const fieldSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/),
  label: localized(80),
  hint: localized(300).optional(),
  type: z.enum(['text', 'textarea', 'secret', 'number', 'boolean', 'select']).default('text'),
  required: z.boolean().default(false),
  default: z.union([z.string().max(5000), z.number(), z.boolean()]).optional(),
  options: z
    .array(z.object({ value: z.string().max(100), label: localized(80) }))
    .max(50)
    .optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

const actionSchema = z.object({
  id: slug,
  label: localized(60),
  icon: z.enum(PLUGIN_ICONS).default('extension'),
  kinds: z
    .array(z.enum(['file', 'folder']))
    .min(1)
    .default(['file']),
  extensions: z
    .array(z.string().regex(/^[a-z0-9]{1,12}$/))
    .max(50)
    .optional(),
  multiple: z.boolean().default(false),
  confirm: localized(300).optional(),
  admin: z.boolean().default(false),
});

const pageSchema = z.object({
  id: slug,
  label: localized(40),
  icon: z.enum(PLUGIN_ICONS).default('extension'),
  path: z.string().regex(/^web\/[A-Za-z0-9._/-]{1,150}\.html$/, 'Seiten liegen unter web/ und enden auf .html'),
  admin: z.boolean().default(false),
});

const manifestSchema = z.object({
  id: slug,
  name: localized(60),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
  description: localized(300).optional(),
  author: z.string().trim().max(100).optional(),
  homepage: z
    .string()
    .max(300)
    .regex(/^https:\/\/[^\s]+$/)
    .optional(),
  api: z.literal(PLUGIN_API),
  moecloud: z
    .string()
    .regex(/^>=\d+\.\d+\.\d+$/)
    .optional(),
  main: z
    .string()
    .regex(/^[A-Za-z0-9._/-]{1,150}\.m?js$/)
    .optional(),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)).max(4).default([]),
  settings: z.array(fieldSchema).max(40).default([]),
  actions: z.array(actionSchema).max(20).default([]),
  pages: z.array(pageSchema).max(10).default([]),
  themes: z
    .array(specSchema.extend({ name: text(40) }))
    .max(20)
    .default([]),
});

export type PluginManifest = z.infer<typeof manifestSchema>;
type Field = PluginManifest['settings'][number];
type SettingValue = string | number | boolean | null;

export type PluginStatus = 'invalid' | 'off' | 'changed' | 'active' | 'failed' | 'stopped';

interface Found {
  id: string;
  dir: string;
  manifest: PluginManifest | null;
  hash: string;
  stamp: string;
  files: number;
  bytes: number;
  error: string | null;
}

export interface PluginUser {
  id: number;
  username: string;
  name: string;
  email: string | null;
  role: 'admin' | 'user' | 'guest';
  language: Lang | null;
}

export interface PluginFile {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  mime: string | null;
  sha256: string | null;
  parentId: string | null;
  ownerId: number;
  modifiedAt: number;
}

export interface PluginRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  rawBody: Buffer | null;
  headers: Record<string, string>;
  ip: string;
  lang: Lang;
  user: PluginUser | null;
}

export interface PluginReply {
  status(code: number): PluginReply;
  header(name: string, value: string): PluginReply;
  type(mime: string): PluginReply;
}

type Handler = (payload: Record<string, unknown>, event: string) => unknown;
type Filter = (payload: Record<string, unknown>) => unknown;
type RouteHandler = (request: PluginRequest, reply: PluginReply) => unknown;
type ActionHandler = (input: { user: PluginUser; nodes: PluginFile[]; lang: Lang }) => unknown;
type Access = 'user' | 'admin' | 'public';

interface RouteEntry {
  method: string;
  parts: string[];
  access: Access;
  handler: RouteHandler;
}

class Rejection extends Error {}

class Instance {
  found: Found;
  manifest: PluginManifest;
  handlers = new Map<string, Set<Handler>>();
  filters = new Map<string, Set<Filter>>();
  routes: RouteEntry[] = [];
  actions = new Map<string, ActionHandler>();
  timers: NodeJS.Timeout[] = [];
  watchers = new Set<(values: Record<string, SettingValue>) => unknown>();
  dispose: (() => unknown) | null = null;
  errors = 0;
  lastError: { message: string; where: string; at: number } | null = null;

  constructor(found: Found, manifest: PluginManifest) {
    this.found = found;
    this.manifest = manifest;
  }

  fail(where: string, error: unknown) {
    this.errors += 1;
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = { message: message.slice(0, 500), where, at: Date.now() };
    log.warn({ plugin: this.found.id, where, error: message }, 'Ein Plugin hat einen Fehler gemeldet');
  }
}

const found = new Map<string, Found>();
const active = new Map<string, Instance>();
const failures = new Map<string, string>();
let started = false;

export const pick = (lang: Lang, value: Localized | undefined): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return lang === 'en' ? (value.en ?? value.de) : value.de;
};

const pluginUser = (user: UserRow): PluginUser => ({
  id: user.id,
  username: user.username,
  name: user.name,
  email: user.email,
  role: user.role === 'team' ? 'user' : user.role,
  language: user.language,
});

const pluginFile = (node: NodeRow): PluginFile => ({
  id: node.id,
  name: node.name,
  type: node.type,
  size: node.size,
  mime: node.mime,
  sha256: node.sha256,
  parentId: node.parent_id,
  ownerId: node.owner_id,
  modifiedAt: node.modified_at,
});

function withTimeout<T>(work: Promise<T> | T, ms: number, label: string): Promise<T> {
  return new Promise<T>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`${label} hat nach ${Math.round(ms / 1000)} Sekunden nicht geantwortet`)), ms);
    timer.unref();
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        done(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

function newer(wanted: string, current: string) {
  const a = wanted.replace(/^>=/, '').split('.').map(Number);
  const b = current.split('-')[0].split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

async function hashDir(dir: string, quick = false) {
  const hash = createHash('sha256');
  const stamp = createHash('sha256');
  let files = 0;
  let bytes = 0;
  const walk = async (folder: string, prefix: string) => {
    const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.DS_Store') continue;
      const path = join(folder, entry.name);
      const name = `${prefix}${entry.name}`;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Verknüpfungen sind in Plugins nicht erlaubt: ${name}`);
      if (info.isDirectory()) {
        await walk(path, `${name}/`);
        continue;
      }
      if (!info.isFile()) continue;
      files += 1;
      bytes += info.size;
      if (files > MAX_FILES || bytes > MAX_BYTES) throw new Error('Das Plugin ist zu groß. Bündle den Code in wenige Dateien');
      stamp.update(`${name}\0${info.size}\0${info.mtimeMs}\n`);
      if (quick) continue;
      hash.update(`${name}\0${info.size}\0`);
      await new Promise<void>((done, fail) => {
        createReadStream(path)
          .on('data', (chunk) => hash.update(chunk))
          .on('error', fail)
          .on('end', () => done());
      });
    }
  };
  await walk(dir, '');
  return { hash: hash.digest('hex'), stamp: stamp.digest('hex'), files, bytes };
}

async function inspect(name: string): Promise<Found | null> {
  const dir = join(config.paths.plugins, name);
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) return null;
  const real = await realpath(dir).catch(() => dir);
  const base: Found = { id: name, dir: real, manifest: null, hash: '', stamp: '', files: 0, bytes: 0, error: null };
  const raw = await readFile(join(real, 'plugin.json'), 'utf8').catch(() => null);
  if (raw === null) return /^[a-z0-9][a-z0-9-]*$/.test(name) ? { ...base, error: 'Im Ordner fehlt die Datei plugin.json' } : null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...base, error: 'plugin.json ist kein gültiges JSON' };
  }
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ...base, error: `plugin.json passt nicht: ${issue?.path.join('.') || 'Aufbau'} (${issue?.message ?? 'ungültig'})` };
  }
  if (parsed.data.id !== name) return { ...base, error: `Der Ordner muss wie das Plugin heißen: ${parsed.data.id}` };
  try {
    return { ...base, manifest: parsed.data, ...(await hashDir(real)) };
  } catch (error) {
    return { ...base, manifest: parsed.data, error: (error as Error).message };
  }
}

let chain: Promise<unknown> = Promise.resolve();

export function withPluginLock<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work);
  chain = next.catch(() => undefined);
  return next;
}

async function scan() {
  const next = new Map<string, Found>();
  if (config.plugins.enabled) {
    const names = await readdir(config.paths.plugins).catch(() => [] as string[]);
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue;
      const entry = await inspect(name);
      if (entry) next.set(entry.id, entry);
    }
  }
  found.clear();
  for (const [id, entry] of next) found.set(id, entry);
  return [...found.values()];
}

export const scanPlugins = () => withPluginLock(scan);

const states = () => settings.get('plugins.state');
const stateOf = (id: string) => states()[id] ?? null;
let reconciled = '';

function setState(id: string, next: { enabled: boolean; hash: string } | null) {
  const all = { ...states() };
  if (next) all[id] = { ...next, at: Date.now() };
  else delete all[id];
  settings.set('plugins.state', all);
  reconciled = JSON.stringify(all);
}

function defaults(manifest: PluginManifest) {
  const values: Record<string, SettingValue> = {};
  for (const field of manifest.settings) {
    values[field.key] = field.default ?? (field.type === 'boolean' ? false : field.type === 'number' ? null : '');
  }
  return values;
}

function valuesOf(manifest: PluginManifest): Record<string, SettingValue> {
  const stored = settings.get('plugins.settings')[manifest.id] ?? {};
  const values = defaults(manifest);
  for (const field of manifest.settings) {
    if (field.key in stored) values[field.key] = stored[field.key] as SettingValue;
  }
  return values;
}

function checkValue(field: Field, value: unknown, lang: Lang): SettingValue {
  const label = pick(lang, field.label);
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') throw badRequest('„{label}“ braucht Ja oder Nein', { label });
    return value;
  }
  if (field.type === 'number') {
    if (value === null || value === '') {
      if (field.required) throw badRequest('„{label}“ fehlt', { label });
      return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw badRequest('„{label}“ muss eine Zahl sein', { label });
    if (field.min !== undefined && number < field.min) throw badRequest('„{label}“ ist zu klein', { label });
    if (field.max !== undefined && number > field.max) throw badRequest('„{label}“ ist zu groß', { label });
    return number;
  }
  const string = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  if (string.length > 5000) throw badRequest('„{label}“ ist zu lang', { label });
  if (field.required && string.trim() === '') throw badRequest('„{label}“ fehlt', { label });
  if (field.type === 'select' && string !== '' && !(field.options ?? []).some((option) => option.value === string)) {
    throw badRequest('„{label}“ kennt diese Auswahl nicht', { label });
  }
  return string;
}

function parseEvery(every: number | string) {
  if (typeof every === 'number') return every;
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(every.trim());
  if (!match) throw new Error(`Unbekannter Abstand für eine Aufgabe: ${every}`);
  return Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
}

function userById(id: number) {
  const user = getUser(Number(id));
  if (!user) throw new Error(`Das Konto ${id} gibt es nicht`);
  return user;
}

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeout?: number;
  maxBytes?: number;
  private?: boolean;
}

function guardedFetch(target: string, init: FetchInit = {}) {
  const url = checkUrl(target);
  if (!init.private && privateLiteral(url)) return Promise.reject(new Error('Die Adresse zeigt ins lokale Netz'));
  const limit = init.maxBytes ?? 5 * 1024 * 1024;
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<{
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    body: Buffer;
    text: () => string;
    json: () => unknown;
  }>((done, fail) => {
    const outgoing = send(
      url,
      {
        method: init.method ?? 'GET',
        headers: { 'User-Agent': userAgent(), ...init.headers },
        lookup: guardedLookup(() => init.private === true),
        timeout: init.timeout ?? 15_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            outgoing.destroy(new Error('Die Antwort ist zu groß'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', fail);
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          const status = response.statusCode ?? 0;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers))
            headers[key] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
          done({
            status,
            ok: status >= 200 && status < 300,
            headers,
            body,
            text: () => body.toString('utf8'),
            json: () => JSON.parse(body.toString('utf8')),
          });
        });
      }
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('Die Gegenseite antwortet nicht')));
    outgoing.on('error', fail);
    outgoing.end(init.body);
  });
}

function apiFor(instance: Instance) {
  const id = instance.found.id;
  const guard =
    <T extends unknown[]>(where: string, work: (...args: T) => unknown) =>
    async (...args: T) => {
      try {
        return await work(...args);
      } catch (error) {
        instance.fail(where, error);
        return undefined;
      }
    };
  const need = (permission: Permission) => {
    if (!instance.manifest.permissions.includes(permission)) {
      throw new Error(`Dafür muss in plugin.json unter permissions „${permission}“ stehen`);
    }
  };
  const add = <T>(map: Map<string, Set<T>>, key: string, value: T) => {
    if (typeof value !== 'function') throw new Error('Erwartet wird eine Funktion');
    const set = map.get(key) ?? new Set<T>();
    set.add(value);
    map.set(key, set);
  };
  const route =
    (access: Access) =>
    (method: string, path: string, handler: RouteHandler, options: { admin?: boolean } = {}) => {
      const verb = String(method).toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) throw new Error(`Unbekannte Methode: ${method}`);
      if (typeof path !== 'string' || !/^\/[A-Za-z0-9._~:/-]*(\/\*)?$/.test(path)) throw new Error(`Ungültiger Pfad: ${path}`);
      if (typeof handler !== 'function') throw new Error('Erwartet wird eine Funktion');
      if (instance.routes.length >= 200) throw new Error('Zu viele Routen');
      instance.routes.push({
        method: verb,
        parts: path.split('/').filter(Boolean),
        access: access === 'public' ? 'public' : options.admin ? 'admin' : 'user',
        handler,
      });
    };
  return Object.freeze({
    id,
    version: instance.manifest.version,
    moecloud: config.version,
    api: PLUGIN_API,
    dev: config.plugins.dev,
    log: Object.freeze({
      info: (message: string, data: Record<string, unknown> = {}) => log.info({ plugin: id, ...data }, String(message)),
      warn: (message: string, data: Record<string, unknown> = {}) => log.warn({ plugin: id, ...data }, String(message)),
      error: (message: string, data: Record<string, unknown> = {}) => log.error({ plugin: id, ...data }, String(message)),
    }),
    settings: Object.freeze({
      get: (key: string) => valuesOf(instance.manifest)[key] ?? null,
      all: () => valuesOf(instance.manifest),
      onChange: (listener: (values: Record<string, SettingValue>) => unknown) => {
        if (typeof listener !== 'function') throw new Error('Erwartet wird eine Funktion');
        instance.watchers.add(listener);
      },
    }),
    store: Object.freeze({
      get: (key: string): unknown => {
        const row = one<{ value: string }>('SELECT value FROM plugin_store WHERE plugin = ? AND key = ?', id, String(key));
        return row ? (JSON.parse(row.value) as unknown) : null;
      },
      set: (key: string, value: unknown) => {
        const name = String(key);
        if (!name || name.length > 200) throw new Error('Schlüssel brauchen 1 bis 200 Zeichen');
        const json = JSON.stringify(value ?? null);
        if (json.length > 1_000_000) throw new Error('Der Wert ist zu groß für den Speicher des Plugins');
        run(
          `INSERT INTO plugin_store (plugin, key, value, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (plugin, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          id,
          name,
          json,
          Date.now()
        );
      },
      delete: (key: string) => {
        run('DELETE FROM plugin_store WHERE plugin = ? AND key = ?', id, String(key));
      },
      keys: (prefix = '') =>
        all<{ key: string }>('SELECT key FROM plugin_store WHERE plugin = ? ORDER BY key', id)
          .map((row) => row.key)
          .filter((key) => key.startsWith(String(prefix))),
    }),
    on: (event: string, handler: Handler) => add(instance.handlers, String(event), handler),
    filter: (name: string, handler: Filter) => {
      if (name !== 'upload') throw new Error(`Diesen Filter gibt es nicht: ${name}`);
      add(instance.filters, name, handler);
    },
    reject: (message: string) => new Rejection(String(message).slice(0, 300)),
    route: route('user'),
    publicRoute: (method: string, path: string, handler: RouteHandler) => route('public')(method, path, handler),
    action: (action: string, handler: ActionHandler) => {
      if (!instance.manifest.actions.some((entry) => entry.id === action))
        throw new Error(`Die Aktion ${action} steht nicht in plugin.json`);
      if (typeof handler !== 'function') throw new Error('Erwartet wird eine Funktion');
      instance.actions.set(action, handler);
    },
    job: (name: string, every: number | string, handler: () => unknown) => {
      if (typeof handler !== 'function') throw new Error('Erwartet wird eine Funktion');
      if (instance.timers.length >= 20) throw new Error('Zu viele Aufgaben');
      const interval = Math.max(config.plugins.dev ? 1000 : MIN_INTERVAL, parseEvery(every));
      let running = false;
      const timer = setInterval(() => {
        if (running) return;
        running = true;
        void guard(`Aufgabe ${name}`, handler)().finally(() => {
          running = false;
        });
      }, interval);
      timer.unref();
      instance.timers.push(timer);
    },
    notify: (userId: number, message: { title: string; text?: string; url?: string; email?: boolean }) => {
      need('notify');
      const title = String(message?.title ?? '').slice(0, 200);
      if (!title) throw new Error('Eine Benachrichtigung braucht einen Titel');
      const url = typeof message.url === 'string' && /^\/[^/\\]/.test(message.url) ? message.url.slice(0, 500) : null;
      notify(
        userById(userId).id,
        'plugin',
        { title, text: String(message.text ?? '').slice(0, 1000), plugin: pick(settings.get('site.language'), instance.manifest.name) },
        url,
        { email: message.email !== false }
      );
    },
    users: Object.freeze({
      get: (userId: number) => {
        need('users');
        const user = getUser(Number(userId));
        return user ? pluginUser(user) : null;
      },
      list: () => {
        need('users');
        return listUsers().map(pluginUser);
      },
    }),
    files: Object.freeze({
      get: (userId: number, nodeId: string) => {
        need('files');
        try {
          return pluginFile(requireAccess(userById(userId), String(nodeId), 'view').node);
        } catch (error) {
          if (error instanceof HttpError && error.status === 404) return null;
          throw error;
        }
      },
      list: (userId: number, folderId?: string) => {
        need('files');
        const user = userById(userId);
        return children(requireFolder(user, folderId ? String(folderId) : user.root_id, 'view').node.id).map(pluginFile);
      },
      folder: (userId: number, parentId: string | null, name: string) => {
        need('files');
        const user = userById(userId);
        const parent = requireFolder(user, parentId ? String(parentId) : user.root_id, 'edit').node;
        const wanted = String(name).trim();
        const existing = children(parent.id).find((entry) => entry.type === 'folder' && entry.name === wanted);
        return pluginFile(existing ?? createFolder(user, parent.id, wanted));
      },
      read: async (userId: number, nodeId: string, options: { maxBytes?: number } = {}) => {
        need('files');
        const node = requireAccess(userById(userId), String(nodeId), 'view').node;
        if (node.type !== 'file' || !node.sha256) throw new Error('Das ist keine Datei');
        const limit = options.maxBytes ?? 50 * 1024 * 1024;
        if (node.size > limit) throw new Error('Die Datei ist größer als die erlaubte Grenze');
        return readFile(blobPath(node.sha256));
      },
      stream: (userId: number, nodeId: string) => {
        need('files');
        const node = requireAccess(userById(userId), String(nodeId), 'view').node;
        if (node.type !== 'file' || !node.sha256) throw new Error('Das ist keine Datei');
        return createReadStream(blobPath(node.sha256));
      },
      write: async (
        userId: number,
        parentId: string | null,
        name: string,
        data: string | Buffer | Readable,
        options: { conflict?: 'rename' | 'replace' } = {}
      ) => {
        need('files');
        const user = userById(userId);
        const content = typeof data === 'string' ? Buffer.from(data) : data;
        const stream = Buffer.isBuffer(content) ? Readable.from([content]) : content;
        const node = await uploadStream(
          { user, link: null },
          { parentId: parentId ? String(parentId) : user.root_id, name: String(name), conflict: options.conflict ?? 'rename' },
          stream,
          Buffer.isBuffer(content) ? content.length : undefined
        );
        return pluginFile(node);
      },
    }),
    fetch: (url: string, options?: FetchInit) => {
      try {
        need('network');
      } catch (error) {
        return Promise.reject(error as Error);
      }
      return guardedFetch(url, options);
    },
  });
}

export type PluginApi = ReturnType<typeof apiFor>;

async function activate(entry: Found) {
  const manifest = entry.manifest;
  if (!manifest || entry.error) return;
  await deactivate(entry.id);
  failures.delete(entry.id);
  if (manifest.moecloud && newer(manifest.moecloud, config.version)) {
    failures.set(entry.id, `Das Plugin braucht MoeCloud ${manifest.moecloud.replace('>=', '')} oder neuer`);
    return;
  }
  const instance = new Instance(entry, manifest);
  const main = manifest.main ?? 'index.js';
  const file = resolve(entry.dir, main);
  if (!file.startsWith(entry.dir + sep)) {
    failures.set(entry.id, 'Der Einstieg liegt außerhalb des Plugins');
    return;
  }
  const exists = await stat(file).then(
    (info) => info.isFile(),
    () => false
  );
  if (!exists && manifest.main) {
    failures.set(entry.id, `Die Datei ${main} fehlt`);
    return;
  }
  if (exists) {
    try {
      const module = (await import(`${pathToFileURL(file).href}?v=${entry.hash.slice(0, 16)}`)) as { default?: unknown; setup?: unknown };
      const setup = module.default ?? module.setup;
      if (typeof setup !== 'function') throw new Error('Das Plugin exportiert keine Funktion als default');
      const dispose = await withTimeout((setup as (api: PluginApi) => unknown)(apiFor(instance)), SETUP_TIMEOUT, 'Der Start des Plugins');
      if (typeof dispose === 'function') instance.dispose = dispose as () => unknown;
    } catch (error) {
      for (const timer of instance.timers) clearInterval(timer);
      const message = error instanceof Error ? error.message : String(error);
      failures.set(entry.id, message.slice(0, 500));
      log.warn({ plugin: entry.id, error: message }, 'Ein Plugin ließ sich nicht starten');
      return;
    }
  }
  active.set(entry.id, instance);
  log.info({ plugin: entry.id, version: manifest.version }, 'Plugin gestartet');
}

async function deactivate(id: string) {
  const instance = active.get(id);
  if (!instance) return;
  active.delete(id);
  for (const timer of instance.timers) clearInterval(timer);
  if (instance.dispose) {
    await withTimeout(Promise.resolve().then(instance.dispose), SETUP_TIMEOUT, 'Das Beenden des Plugins').catch((error: Error) =>
      log.warn({ plugin: id, error: error.message }, 'Ein Plugin ließ sich nicht sauber beenden')
    );
  }
}

function dispatch(name: string, payload: Record<string, unknown>) {
  const group = `${name.split('.')[0]}.*`;
  for (const instance of active.values()) {
    for (const key of [name, group, '*']) {
      for (const handler of instance.handlers.get(key) ?? []) {
        Promise.resolve()
          .then(() => handler({ ...payload }, name))
          .catch((error: unknown) => instance.fail(`Ereignis ${name}`, error));
      }
    }
  }
}

async function filterAll(name: string, payload: Record<string, unknown>) {
  for (const instance of active.values()) {
    for (const filter of instance.filters.get(name) ?? []) {
      try {
        await withTimeout(
          Promise.resolve().then(() => filter({ ...payload })),
          FILTER_TIMEOUT,
          `Der Filter ${name}`
        );
      } catch (error) {
        if (error instanceof Rejection) throw new HttpError(422, error.message || 'Ein Plugin hat die Datei abgelehnt', 'rejected');
        instance.fail(`Filter ${name}`, error);
      }
    }
  }
}

let watching: NodeJS.Timeout | null = null;

export function startPlugins() {
  return withPluginLock(async () => {
    started = true;
    if (!config.plugins.enabled) {
      setHooks({ listener: null, filter: null });
      return { found: 0, active: 0 };
    }
    setHooks({ listener: dispatch, filter: filterAll });
    const entries = await scan();
    await settle(entries);
    reconciled = JSON.stringify(states());
    if (config.plugins.dev && !watching) {
      watching = setInterval(() => void reconcilePlugins().catch(() => undefined), DEV_WATCH);
      watching.unref();
    }
    return { found: entries.length, active: active.size };
  });
}

export function stopPlugins() {
  return withPluginLock(async () => {
    if (watching) clearInterval(watching);
    watching = null;
    for (const id of [...active.keys()]) await deactivate(id);
    setHooks({ listener: null, filter: null });
    started = false;
  });
}

function statusOf(entry: Found): PluginStatus {
  if (entry.error || !entry.manifest) return 'invalid';
  const state = stateOf(entry.id);
  if (!state?.enabled) return 'off';
  if (active.has(entry.id)) return 'active';
  if (failures.has(entry.id)) return 'failed';
  if (!config.plugins.dev && state.hash !== entry.hash) return 'changed';
  return 'stopped';
}

function describe(entry: Found, lang: Lang) {
  const manifest = entry.manifest;
  const instance = active.get(entry.id);
  const values = manifest ? valuesOf(manifest) : {};
  return {
    id: entry.id,
    name: manifest ? pick(lang, manifest.name) : entry.id,
    version: manifest?.version ?? '',
    description: pick(lang, manifest?.description),
    author: manifest?.author ?? '',
    homepage: manifest?.homepage ?? '',
    status: statusOf(entry),
    error: entry.error ?? failures.get(entry.id) ?? null,
    hash: entry.hash,
    files: entry.files,
    bytes: entry.bytes,
    code: Boolean(manifest && (manifest.main || instance?.dispose !== undefined)) && !entry.error,
    permissions: manifest?.permissions ?? [],
    settings: (manifest?.settings ?? []).map((field) => ({
      key: field.key,
      label: pick(lang, field.label),
      hint: pick(lang, field.hint),
      type: field.type,
      required: field.required,
      min: field.min ?? null,
      max: field.max ?? null,
      options: (field.options ?? []).map((option) => ({ value: option.value, label: pick(lang, option.label) })),
      value: field.type === 'secret' ? null : (values[field.key] ?? null),
      filled: field.type === 'secret' ? Boolean(values[field.key]) : undefined,
    })),
    actions: (manifest?.actions ?? []).map((action) => pick(lang, action.label)),
    pages: (manifest?.pages ?? []).map((page) => pick(lang, page.label)),
    themes: manifest?.themes.length ?? 0,
    routes: instance?.routes.length ?? 0,
    jobs: instance?.timers.length ?? 0,
    events: instance ? [...instance.handlers.keys()] : [],
    errors: instance?.errors ?? 0,
    lastError: instance?.lastError ?? null,
  };
}

export function listPlugins(lang: Lang) {
  return {
    enabled: config.plugins.enabled,
    dev: config.plugins.dev,
    upload: config.plugins.upload,
    dir: config.paths.plugins,
    items: [...found.values()].map((entry) => describe(entry, lang)),
  };
}

function requireFound(id: string) {
  const entry = found.get(id);
  if (!entry) throw notFound('Dieses Plugin gibt es nicht mehr');
  return entry;
}

export const enablePlugin = (id: string, hash: string, lang: Lang) => withPluginLock(() => enable(id, hash, lang));

async function enable(id: string, hash: string, lang: Lang) {
  if (!config.plugins.enabled) throw badRequest('Plugins sind auf diesem Server abgeschaltet');
  const before = requireFound(id);
  const entry = (await inspect(before.id)) ?? before;
  found.set(entry.id, entry);
  if (entry.error || !entry.manifest)
    throw badRequest('Dieses Plugin lässt sich nicht einschalten: {reason}', { reason: entry.error ?? '' });
  if (entry.hash !== hash) throw conflict('Die Dateien des Plugins haben sich geändert. Lies die Liste neu ein und prüf es noch einmal');
  for (const field of entry.manifest.settings) {
    const value = valuesOf(entry.manifest)[field.key];
    if (field.required && field.type !== 'boolean' && (value === '' || value === null || value === undefined)) {
      throw badRequest('Trag zuerst die Einstellungen ein, es fehlt „{label}“', { label: pick(lang, field.label) });
    }
  }
  setState(id, { enabled: true, hash: entry.hash });
  if (started) await activate(entry);
  const failure = failures.get(id);
  if (failure) {
    setState(id, { enabled: false, hash: entry.hash });
    throw badRequest('Das Plugin ließ sich nicht starten: {reason}', { reason: failure });
  }
  return describe(entry, lang);
}

export function disablePlugin(id: string, lang: Lang) {
  return withPluginLock(async () => {
    const entry = requireFound(id);
    setState(id, { enabled: false, hash: entry.hash });
    failures.delete(id);
    await deactivate(id);
    return describe(entry, lang);
  });
}

export async function savePluginSettings(id: string, input: Record<string, unknown>, lang: Lang) {
  const entry = requireFound(id);
  const manifest = entry.manifest;
  if (!manifest) throw badRequest('Dieses Plugin hat keine Einstellungen');
  const current = valuesOf(manifest);
  const next: Record<string, SettingValue> = { ...current };
  for (const [key, value] of Object.entries(input)) {
    const field = manifest.settings.find((candidate) => candidate.key === key);
    if (!field) throw badRequest('Die Einstellung „{key}“ kennt das Plugin nicht', { key });
    if (field.type === 'secret' && (value === null || value === undefined)) continue;
    next[key] = checkValue(field, value, lang);
  }
  for (const field of manifest.settings) {
    if (field.required && field.type !== 'boolean' && (next[field.key] === '' || next[field.key] === null)) {
      throw badRequest('„{label}“ fehlt', { label: pick(lang, field.label) });
    }
  }
  settings.set('plugins.settings', { ...settings.get('plugins.settings'), [id]: next });
  const instance = active.get(id);
  if (instance) {
    for (const watcher of instance.watchers) {
      Promise.resolve()
        .then(() => watcher({ ...next }))
        .catch((error: unknown) => instance.fail('Einstellungen', error));
    }
  }
  return describe(entry, lang);
}

export const rescanPlugins = (lang: Lang) => withPluginLock(() => rescan(lang));

type StopReason = 'changed' | 'failed' | 'invalid' | 'missing';

function alertStopped(id: string, entry: Found | undefined, reason: StopReason, error = '') {
  const state = stateOf(id);
  if (!started || !state?.enabled) return;
  const mark = `${reason}:${entry?.hash ?? ''}`;
  if (state.stopped === mark) return;
  const all = { ...states(), [id]: { ...state, stopped: mark } };
  settings.set('plugins.state', all);
  reconciled = JSON.stringify(all);
  const name = entry?.manifest ? pick(settings.get('site.language'), entry.manifest.name) : id;
  const details = { name, reason, error: error.slice(0, 300) };
  log.warn({ plugin: id, reason, error }, 'Ein freigegebenes Plugin steht still');
  audit('plugin_stopped', { details: { ...details, id } });
  notifyAdmins('admin_plugin', details, '/admin/plugins');
}

async function settle(entries: Found[]) {
  for (const id of [...active.keys()]) {
    const entry = found.get(id);
    const state = stateOf(id);
    if (!entry || entry.error || !state?.enabled || (!config.plugins.dev && state.hash !== entry.hash)) await deactivate(id);
  }
  for (const entry of entries) {
    const state = stateOf(entry.id);
    if (!state?.enabled) continue;
    if (entry.error) {
      alertStopped(entry.id, entry, 'invalid', entry.error);
    } else if (!config.plugins.dev && state.hash !== entry.hash) {
      alertStopped(entry.id, entry, 'changed');
    } else if (!active.has(entry.id) || active.get(entry.id)?.found.hash !== entry.hash) {
      await activate(entry);
      const failure = failures.get(entry.id);
      if (failure) alertStopped(entry.id, entry, 'failed', failure);
    } else {
      (active.get(entry.id) as Instance).found = entry;
    }
  }
  for (const [id, state] of Object.entries(states())) {
    if (state.enabled && !found.has(id)) alertStopped(id, undefined, 'missing');
  }
}

async function rescan(lang: Lang) {
  await settle(await scan());
  return listPlugins(lang);
}

export function forgetPlugin(id: string) {
  setState(id, null);
  const stored = { ...settings.get('plugins.settings') };
  delete stored[id];
  settings.set('plugins.settings', stored);
  run('DELETE FROM plugin_store WHERE plugin = ?', id);
}

export function pluginBoot(user: UserRow | null | undefined, lang: Lang) {
  const actions: {
    plugin: string;
    id: string;
    label: string;
    icon: string;
    kinds: string[];
    extensions: string[] | null;
    multiple: boolean;
    confirm: string;
  }[] = [];
  const pages: { plugin: string; id: string; label: string; icon: string; src: string }[] = [];
  if (!user) return { actions, pages };
  for (const instance of active.values()) {
    for (const action of instance.manifest.actions) {
      if (action.admin && user.role !== 'admin') continue;
      if (!instance.actions.has(action.id)) continue;
      actions.push({
        plugin: instance.found.id,
        id: action.id,
        label: pick(lang, action.label),
        icon: action.icon,
        kinds: action.kinds,
        extensions: action.extensions ?? null,
        multiple: action.multiple,
        confirm: pick(lang, action.confirm),
      });
    }
    for (const page of instance.manifest.pages) {
      if (page.admin && user.role !== 'admin') continue;
      pages.push({
        plugin: instance.found.id,
        id: page.id,
        label: pick(lang, page.label),
        icon: page.icon,
        src: `/plugin-pages/${instance.found.id}/${page.path.slice(4)}`,
      });
    }
  }
  return { actions, pages };
}

export function pluginThemes() {
  return [...active.values()].flatMap((instance) =>
    instance.manifest.themes.map((theme) => ({ ...theme, plugin: pick(settings.get('site.language'), instance.manifest.name) }))
  );
}

export async function runAction(user: UserRow, pluginId: string, actionId: string, ids: string[], lang: Lang) {
  const instance = active.get(pluginId);
  const action = instance?.manifest.actions.find((entry) => entry.id === actionId);
  const handler = instance?.actions.get(actionId);
  if (!instance || !action || !handler) throw notFound('Diese Aktion gibt es nicht mehr');
  if (action.admin && user.role !== 'admin') throw notFound('Diese Aktion gibt es nicht mehr');
  if (ids.length === 0) throw badRequest('Wähl mindestens ein Element aus');
  if (!action.multiple && ids.length > 1) throw badRequest('Diese Aktion geht nur mit einem Element');
  const nodes = ids.map((id) => requireAccess(user, id, 'view').node);
  for (const node of nodes) {
    const extension = node.name.includes('.') ? node.name.split('.').pop()!.toLowerCase() : '';
    if (!action.kinds.includes(node.type) || (node.type === 'file' && action.extensions && !action.extensions.includes(extension))) {
      throw badRequest('Die Aktion passt nicht zu „{name}“', { name: node.name });
    }
  }
  let result: unknown;
  try {
    result = await withTimeout(
      Promise.resolve().then(() => handler({ user: pluginUser(user), nodes: nodes.map(pluginFile), lang })),
      ROUTE_TIMEOUT,
      'Die Aktion'
    );
  } catch (error) {
    if (error instanceof Rejection) throw new HttpError(422, error.message, 'rejected');
    instance.fail(`Aktion ${actionId}`, error);
    throw badRequest('Das Plugin „{name}“ hat einen Fehler gemeldet', { name: pick(lang, instance.manifest.name) });
  }
  const output = (result && typeof result === 'object' ? result : {}) as { message?: unknown; open?: unknown; refresh?: unknown };
  const open =
    typeof output.open === 'string' && (/^\/[^/\\]/.test(output.open) || /^https:\/\//.test(output.open))
      ? output.open.slice(0, 1000)
      : null;
  return {
    message: typeof output.message === 'string' ? output.message.slice(0, 300) : null,
    open,
    refresh: output.refresh === true,
  };
}

function match(parts: string[], path: string[]) {
  const params: Record<string, string> = {};
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === '*') {
      params['*'] = path.slice(index).join('/');
      return params;
    }
    const value = path[index];
    if (value === undefined) return null;
    if (part.startsWith(':')) params[part.slice(1)] = value;
    else if (part !== value) return null;
  }
  return parts.length === path.length ? params : null;
}

export interface RouteCall {
  plugin: string;
  method: string;
  path: string;
  scope: 'api' | 'public';
  user: UserRow | null;
  query: Record<string, string>;
  body: unknown;
  rawBody: Buffer | null;
  headers: Record<string, string>;
  ip: string;
  lang: Lang;
}

export async function callRoute(call: RouteCall) {
  const instance = active.get(call.plugin);
  if (!instance) throw notFound('Dieses Plugin läuft nicht');
  const path = call.path.split('/').filter(Boolean);
  let allowed = false;
  for (const route of instance.routes) {
    if ((route.access === 'public') !== (call.scope === 'public')) continue;
    const params = match(route.parts, path);
    if (!params) continue;
    if (route.method !== call.method) {
      allowed = true;
      continue;
    }
    if (route.access !== 'public' && !call.user) throw new HttpError(401, 'Bitte melde dich an', 'unauthorized');
    if (route.access === 'admin' && call.user?.role !== 'admin') throw new HttpError(403, 'Dafür fehlen dir die Rechte', 'forbidden');
    const state = { status: 200, headers: {} as Record<string, string>, type: null as string | null };
    const reply: PluginReply = {
      status(code) {
        if (Number.isInteger(code) && code >= 100 && code <= 599) state.status = code;
        return reply;
      },
      header(name, value) {
        const key = String(name).toLowerCase();
        if (/^[a-z0-9-]{1,60}$/.test(key) && !['set-cookie', 'content-security-policy', 'content-length'].includes(key)) {
          state.headers[key] = String(value)
            .replace(/[\r\n]+/g, ' ')
            .slice(0, 2000);
        }
        return reply;
      },
      type(mime) {
        state.type = String(mime)
          .replace(/[\r\n]+/g, ' ')
          .slice(0, 200);
        return reply;
      },
    };
    try {
      const result = await withTimeout(
        Promise.resolve().then(() =>
          route.handler(
            {
              method: call.method,
              path: `/${path.join('/')}`,
              params,
              query: call.query,
              body: call.body,
              rawBody: call.rawBody,
              headers: call.headers,
              ip: call.ip,
              lang: call.lang,
              user: call.user ? pluginUser(call.user) : null,
            },
            reply
          )
        ),
        ROUTE_TIMEOUT,
        'Die Route'
      );
      return { ...state, result };
    } catch (error) {
      if (error instanceof Rejection) throw new HttpError(422, error.message, 'rejected');
      if (error instanceof HttpError) throw error;
      instance.fail(`Route ${call.method} /${path.join('/')}`, error);
      throw new HttpError(502, 'Das Plugin hat einen Fehler gemeldet', 'plugin_failed');
    }
  }
  if (allowed) throw new HttpError(405, 'Diese Methode geht hier nicht', 'method_not_allowed');
  throw notFound('Diese Adresse kennt das Plugin nicht');
}

export async function pageFile(pluginId: string, rest: string) {
  const instance = active.get(pluginId);
  if (!instance || instance.manifest.pages.length === 0) return null;
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(rest) || rest.split('/').some((part) => part === '' || part.startsWith('.'))) return null;
  const root = join(instance.found.dir, 'web');
  const file = resolve(root, rest);
  if (!file.startsWith(root + sep)) return null;
  const real = await realpath(file).catch(() => null);
  if (!real || !real.startsWith(instance.found.dir + sep)) return null;
  const info = await stat(real).catch(() => null);
  return info?.isFile() ? { path: real, size: info.size, modified: info.mtimeMs } : null;
}

export const activePlugins = () => [...active.keys()];

export function reconcilePlugins() {
  return withPluginLock(async () => {
    if (!started || !config.plugins.enabled) return false;
    const snapshot = JSON.stringify(states());
    let changed = snapshot !== reconciled;
    reconciled = snapshot;
    for (const instance of active.values()) {
      if (changed) break;
      const now = await hashDir(instance.found.dir, true).catch(() => null);
      changed = now?.stamp !== instance.found.stamp;
    }
    if (!changed) return false;
    await rescan(settings.get('site.language'));
    return true;
  });
}

export const unlocked = { scan, stop: deactivate };

export function parseManifest(raw: string) {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw badRequest('plugin.json ist kein gültiges JSON');
  }
  const parsed = manifestSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest('plugin.json passt nicht: {reason}', {
      reason: `${issue?.path.join('.') || 'Aufbau'} (${issue?.message ?? 'ungültig'})`,
    });
  }
  return parsed.data;
}

export const PLUGIN_LIMITS = { files: MAX_FILES, bytes: MAX_BYTES };
