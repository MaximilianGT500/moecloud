import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign, type KeyObject } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOCOL = 1;
export const SDK_VERSION = '1.2.0';
export const DEFAULT_ENDPOINT = 'https://pulse.moestudio.net';

export type Primitive = string | number | boolean | null;
export type Facts = Record<string, Primitive>;
export type Numbers = Record<string, number>;
export type Level = 'fatal' | 'error' | 'warning';

export interface Consent {
  stats: boolean;
  errors: boolean;
}

export interface IdentityStore {
  load(): Promise<string | null> | string | null;
  save(value: string): Promise<void> | void;
  clear?(): Promise<void> | void;
}

export interface PulseOptions {
  app: string;
  version: string;
  dataDir: string;
  consent: () => boolean | Consent | Promise<boolean | Consent>;
  endpoint?: string;
  install?: string;
  channel?: string;
  features?: () => Facts | Promise<Facts>;
  metrics?: () => Numbers | Promise<Numbers>;
  root?: string;
  paths?: Record<string, string>;
  redact?: () => Array<string | RegExp>;
  crashes?: boolean;
  interval?: number;
  timeout?: number;
  identity?: IdentityStore;
  log?: (level: 'debug' | 'warn', message: string) => void;
  fetch?: typeof fetch;
}

export interface Frame {
  fn: string;
  file: string;
  line: number;
  col: number;
  app: boolean;
}

export interface ErrorEvent {
  id: string;
  time: number;
  level: Level;
  type: string;
  code: string | null;
  message: string;
  frames: Frame[];
  raw: string;
  count: number;
  version: string;
  context: Facts;
  handled: boolean;
  origin: string;
}

export interface SystemInfo {
  os: { platform: string; name: string; release: string; arch: string };
  runtime: { name: string; version: string };
  cpu: { model: string | null; cores: number; load: number[] | null };
  memory: { total: number; free: number; limit: number | null; process: number };
  disk: { total: number; free: number } | null;
  uptime: { system: number; process: number };
  container: string | null;
  locale: string;
  timezone: string;
}

export interface Heartbeat {
  protocol: number;
  sdk: string;
  key: string;
  app: string;
  version: string;
  channel: string | null;
  install: string | null;
  scope: 'full' | 'errors';
  started: number;
  runtime: { name: string; version: string };
  system?: SystemInfo;
  features?: Facts;
  metrics?: Numbers;
  counters?: Numbers;
}

export type TicketCategory = 'bug' | 'question' | 'idea' | 'other';
export type TicketStatus = 'open' | 'answered' | 'closed';

export interface TicketInput {
  subject: string;
  message: string;
  category?: TicketCategory;
  name?: string;
  email?: string;
  diagnostics?: boolean;
}

export interface TicketMessage {
  id: number;
  author: 'user' | 'developer' | 'system';
  body: string;
  createdAt: number;
}

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  category: TicketCategory;
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
  unread: boolean;
  last: { author: TicketMessage['author']; body: string; createdAt: number } | null;
}

export interface TicketDetail extends Ticket {
  name: string | null;
  email: string | null;
  messages: TicketMessage[];
}

export interface Notice {
  id: number;
  level: 'info' | 'warning' | 'security';
  title: string;
  body: string;
  link: string | null;
  minVersion: string | null;
  maxVersion: string | null;
  createdAt: number;
}

export interface Support {
  create(input: TicketInput): Promise<TicketDetail>;
  list(): Promise<{ tickets: Ticket[]; unread: number }>;
  get(id: string): Promise<TicketDetail>;
  reply(id: string, message: string): Promise<TicketDetail>;
  close(id: string): Promise<TicketDetail>;
  unread(): number;
}

export class PulseError extends Error {
  code: string;
  status: number;
  retry: number | null;

  constructor(code: string, message: string, status = 0, retry: number | null = null) {
    super(message);
    this.name = 'PulseError';
    this.code = code;
    this.status = status;
    this.retry = retry;
  }
}

const SUPPORT_ERRORS: Record<string, string> = {
  network: 'MoeStudio ist gerade nicht erreichbar. Versuch es später noch einmal.',
  disabled: 'Der Kontakt zu MoeStudio ist auf diesem Server abgeschaltet.',
  limited: 'Gerade kommen zu viele Nachrichten an. Versuch es etwas später noch einmal.',
  blocked: 'Diese Installation kann MoeStudio keine Nachrichten mehr schicken.',
  invalid: 'Bitte prüf Betreff und Nachricht.',
  missing: 'Dieses Ticket gibt es nicht (mehr).',
  closed: 'Dieses Ticket ist geschlossen.',
  paused: 'Der Support nimmt gerade keine neuen Tickets an. Versuch es später noch einmal.',
  app: 'Diese App ist bei MoeStudio nicht angemeldet.',
};

export interface PulseStatus {
  consent: Consent;
  running: boolean;
  interval: number;
  installId: string | null;
  lastHeartbeat: number | null;
  lastError: string | null;
  queued: number;
  blocked: boolean;
}

export interface Release {
  version: string;
  title: string | null;
  date: number | null;
  dateText: string | null;
  url: string | null;
  security: boolean;
  channel: 'stable' | 'beta';
  notes: string | null;
}

export interface UpdateInfo {
  app: string;
  version: string | null;
  channel: 'stable' | 'beta';
  latest: Release | null;
  update: boolean;
  security: boolean;
  yanked: boolean;
  behind: number;
  releases: Release[];
  checkedAt: number;
}

export interface UpdateSummary {
  latest: string;
  update: boolean;
  security: boolean;
  yanked: boolean;
  url: string | null;
}

export interface Pulse {
  support: Support;
  notices(): Notice[];
  fetchNotices(): Promise<Notice[]>;
  update(): UpdateSummary | null;
  checkUpdate(options?: { channel?: 'stable' | 'beta'; force?: boolean }): Promise<UpdateInfo | null>;
  start(): Promise<void>;
  refresh(): Promise<void>;
  stop(): Promise<void>;
  capture(error: unknown, context?: Facts, level?: Level): void;
  message(text: string, context?: Facts, level?: Level): void;
  count(name: string, by?: number): void;
  flush(timeout?: number): Promise<void>;
  preview(consent?: Partial<Consent>): Promise<{ endpoint: string; installId: string | null; heartbeat: Heartbeat }>;
  status(): PulseStatus;
  forget(): Promise<boolean>;
}

interface Identity {
  id: string;
  key: KeyObject;
  publicKey: string;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MAX_SCRUB = 20_000;
const MAX_LINE = 2_000;
const MAX_REPLY = 256 * 1024;
const NONE: Consent = { stats: false, errors: false };
const FULL: Consent = { stats: true, errors: true };
const KEY_NAME = /^[A-Za-z][\w.:-]{0,47}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DARWIN: Record<number, string> = { 20: '11', 21: '12', 22: '13', 23: '14', 24: '15', 25: '26', 26: '27' };

export function canonical(method: string, path: string, id: string, time: string, nonce: string, body: string | Uint8Array) {
  const digest = createHash('sha256').update(body).digest('base64url');
  return ['MOEPULSE1', method.toUpperCase(), path, id, time, nonce, digest].join('\n');
}

export interface ScrubOptions {
  root?: string;
  paths?: Record<string, string>;
  extra?: Array<string | RegExp>;
}

export type Cleaner = (input: unknown) => string;

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanUrl(url: string) {
  const match = /^(https?):\/\/[^/?#\s]+(\/[^?#\s]*)?/i.exec(url);
  if (!match) return '[url]';
  const parts = (match[2] ?? '').split('/').filter(Boolean);
  const first = parts[0] && /^[a-z][a-z0-9_-]{0,23}$/.test(parts[0]) ? `/${parts[0]}` : '';
  const more = parts.length > (first ? 1 : 0) ? '/…' : '';
  return `${match[1].toLowerCase()}://[host]${first}${more}`;
}

const TOKEN = (alphabet: string) =>
  new RegExp(`(?<![\\w/.-])(?=[${alphabet}]*\\d)(?=[${alphabet}]*[A-Z])(?=[${alphabet}]*[a-z])[${alphabet}]{40,}={0,2}(?![\\w/.-])`, 'g');

const PATTERNS: Array<[RegExp, string | ((match: string, ...groups: string[]) => string)]> = [
  [/file:\/\/(?=\/|[A-Za-z]:)/g, ''],
  [/[A-Za-z]:\\Users\\[^\\\s'"`]+/g, '~'],
  [/(?<![\w.-])\/(?:home|Users)\/[^/\s'"`]+/g, '~'],
  [/(?<![\w.-])\/root(?=[\\/\s'"`]|$)/g, '~'],
  [/\bhttps?:\/\/(?!\[host\])[^\s'"`<>)\]]+/gi, (url) => cleanUrl(url)],
  [/(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}\b/g, '[email]'],
  [/(?<=[\w.+-])@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}\b/g, '@[email]'],
  [/(?<![\w-])eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]+/g, '[jwt]'],
  [/\b(Bearer|Basic|Token)\s+[\w.~+/-]+=*/gi, '$1 [token]'],
  [
    /((?:^|[?&;\s{,])["']?[\w-]{0,32}(?:token|secret|password|passwd|apikey|api_key|auth|session|signature|cookie)[\w-]{0,32}["']?\s{0,4}[=:]\s{0,4}["']?)[^&\s'",;}]{6,}/gi,
    '$1[redacted]',
  ],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]'],
  [/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, '[ip]'],
  [/(?<![\w:.])(?=[0-9a-f:]*[0-9a-f])[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){3,7}(?![\w:])/gi, '[ip]'],
  [/\b[0-9a-f]{32,}\b/gi, '[hex]'],
  [TOKEN('A-Za-z0-9_-'), '[token]'],
  [TOKEN('A-Za-z0-9+/'), '[token]'],
];

export function scrubber(options: ScrubOptions = {}): Cleaner {
  const known: Array<[RegExp, string]> = [];
  const dirs: Array<[string, string]> = Object.entries(options.paths ?? {})
    .filter(([label, dir]) => /^[a-z][\w-]{0,15}$/.test(label) && typeof dir === 'string' && dir.length > 1)
    .map(([label, dir]) => [dir.replace(/[\\/]+$/, ''), `[${label}]`]);
  if (options.root && options.root.length > 1) dirs.push([options.root.replace(/[\\/]+$/, ''), '']);
  dirs.sort((a, b) => b[0].length - a[0].length);
  for (const [dir, label] of dirs) {
    const head = `(?:file://)?${escape(dir)}`;
    known.push(label ? [new RegExp(`${head}(?=[\\\\/\\s'"\`,;:)\\]]|$)`, 'g'), label] : [new RegExp(`${head}[\\\\/]`, 'g'), '']);
  }
  const labels = dirs.filter(([, label]) => label).map(([, label]) => label);
  const extra = (options.extra ?? [])
    .filter((item) => (typeof item === 'string' ? item.length >= 3 : item instanceof RegExp))
    .map((item) =>
      typeof item === 'string'
        ? new RegExp(escape(item), 'gi')
        : new RegExp(item.source, item.flags.includes('g') ? item.flags : `${item.flags}g`)
    );
  const home = os.homedir();
  const homePattern = home && home.length > 3 ? new RegExp(`(?<![\\w.-])${escape(home)}(?=[\\\\/\\s'"\`]|$)`, 'g') : null;
  const line = (input: string) => {
    let text = input;
    for (const [pattern, label] of known) text = text.replace(pattern, label);
    if (homePattern) text = text.replace(homePattern, '~');
    for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement as string);
    for (const pattern of extra) text = text.replace(pattern, '[redacted]');
    for (const label of labels) {
      const keep = label === '[data]' ? 1 : 0;
      text = text.replace(new RegExp(`${escape(label)}((?:[\\\\/][^\\s'"\`,;)\\]]+)+)`, 'g'), (_all, rest: string) => {
        const parts = rest.split(/[\\/]/).filter(Boolean);
        return parts.length <= keep ? `${label}/${parts.join('/')}` : `${label}/${[...parts.slice(0, keep), '…'].join('/')}`;
      });
    }
    return text
      .replace(/(^|[\s'"`(=,])(~[\\/][^\s'"`,;)\]]+)/g, (_all, lead: string, path: string) => {
        const parts = path.split(/[\\/]/).filter(Boolean);
        return parts.length <= 2 ? lead + path : `${lead}~/${parts[1]}/…`;
      })
      .replace(/(^|[\s'"`(=,])((?:[A-Za-z]:)?[\\/](?:[^\s'"`,;)\]\\/]+[\\/]){2,}[^\s'"`,;)\]]*)/g, (_all, lead: string, path: string) => {
        if (/node_modules/.test(path)) return lead + path.slice(path.search(/node_modules/)).replace(/\\/g, '/');
        const parts = path.split(/[\\/]/).filter(Boolean);
        const drive = /^[A-Za-z]:$/.test(parts[0] ?? '') ? `${parts.shift()}\\` : '/';
        return `${lead}${drive}${parts.slice(0, 2).join('/')}/…`;
      });
  };
  return (input) => {
    const raw = String(input ?? '');
    const text = raw.length > MAX_SCRUB ? raw.slice(0, MAX_SCRUB) : raw;
    return text
      .split('\n')
      .map((entry) => line(entry.length > MAX_LINE ? `${entry.slice(0, MAX_LINE - 1)}…` : entry))
      .join('\n');
  };
}

export function scrub(input: unknown, options?: ScrubOptions) {
  return scrubber(options)(input);
}

function limit(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function parseStack(stack: string | undefined, root?: string, clean: Cleaner = scrubber()): Frame[] {
  const frames: Frame[] = [];
  for (const line of String(stack ?? '').split('\n')) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!match) continue;
    let file = match[2];
    if (file.startsWith('file://')) {
      try {
        file = fileURLToPath(file);
      } catch {
        file = file.slice(7);
      }
    }
    const internal = file.startsWith('node:') || file.startsWith('internal/') || !/[\\/.]/.test(file);
    const vendor = /[\\/]node_modules[\\/]/.test(file);
    let shown = file;
    if (vendor) shown = file.slice(file.search(/node_modules/)).replace(/\\/g, '/');
    else if (!internal && root && isAbsolute(file)) {
      const rel = relative(root, file);
      shown = rel.startsWith('..') || isAbsolute(rel) ? clean(file) : rel.replace(/\\/g, '/');
    } else if (!internal) shown = clean(file);
    const inside = !internal && !vendor && !/^[\\/~[]/.test(shown) && !/^[A-Za-z]:/.test(shown);
    frames.push({
      fn: limit((match[1] ?? '<anonym>').replace(/^async /, '') || '<anonym>', 120),
      file: limit(shown, 200),
      line: Number(match[3]),
      col: Number(match[4]),
      app: inside,
    });
    if (frames.length >= 40) break;
  }
  return frames;
}

export function normalizeMessage(message: string) {
  return message
    .replace(/\[(?:uuid|ip|email|hex|token|jwt|redacted)\]/g, '?')
    .replace(/(["'`]).*?\1/g, '?')
    .replace(/\b0x[0-9a-f]+\b/gi, '0')
    .replace(/\d+(?:\.\d+)?/g, '0')
    .slice(0, 200);
}

export function fingerprint(type: string, message: string, frames: Frame[]) {
  const own = frames.filter((frame) => frame.app).slice(0, 6);
  const picked = own.length ? own : frames.slice(0, 3);
  const basis = picked.length ? picked.map((frame) => `${frame.file}:${frame.fn}`).join('\n') : normalizeMessage(message);
  return createHash('sha256').update(`${type}\n${basis}`).digest('hex').slice(0, 24);
}

export function cleanFacts(input: unknown, clean: Cleaner = scrubber(), max = 24): Facts {
  const result: Facts = {};
  if (!input || typeof input !== 'object') return result;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(result).length >= max) break;
    if (!KEY_NAME.test(key)) continue;
    if (value === null || typeof value === 'boolean') result[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    else if (typeof value === 'string') result[key] = limit(clean(value), 200);
  }
  return result;
}

function cleanNumbers(input: unknown, max = 32): Numbers {
  const result: Numbers = {};
  if (!input || typeof input !== 'object') return result;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(result).length >= max) break;
    if (KEY_NAME.test(key) && typeof value === 'number' && Number.isFinite(value)) result[key] = value;
  }
  return result;
}

function read(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function osName() {
  const platform = process.platform;
  if (platform === 'linux') {
    const match = /^PRETTY_NAME="?(.*?)"?$/m.exec(read('/etc/os-release'));
    return match?.[1] ? limit(match[1], 80) : 'Linux';
  }
  if (platform === 'darwin') {
    const major = Number.parseInt(os.release(), 10);
    return DARWIN[major] ? `macOS ${DARWIN[major]}` : 'macOS';
  }
  if (platform === 'win32') {
    const build = Number(os.release().split('.')[2] ?? 0);
    const name = os.version() || 'Windows';
    return build >= 22000 ? name.replace('Windows 10', 'Windows 11') : name;
  }
  return `${os.type()} ${os.release()}`;
}

export function detectContainer() {
  if (process.env.KUBERNETES_SERVICE_HOST) return 'kubernetes';
  if (existsSync('/run/.containerenv')) return 'podman';
  if (existsSync('/.dockerenv')) return 'docker';
  const cgroup = read('/proc/1/cgroup');
  if (/kubepods/.test(cgroup)) return 'kubernetes';
  if (/docker|containerd/.test(cgroup)) return 'docker';
  if (/lxc/.test(cgroup) || /container=lxc/.test(read('/proc/1/environ'))) return 'lxc';
  if (/microsoft/i.test(os.release())) return 'wsl';
  return null;
}

function runtime() {
  const versions = process.versions as Record<string, string | undefined>;
  if (versions.bun) return { name: 'bun', version: versions.bun };
  if ((globalThis as { Deno?: unknown }).Deno && versions.deno) return { name: 'deno', version: versions.deno };
  return { name: 'node', version: process.versions.node };
}

export async function systemInfo(dataDir: string): Promise<SystemInfo> {
  const disk = await statfs(dataDir)
    .then((stats) => ({ total: Number(stats.blocks) * Number(stats.bsize), free: Number(stats.bavail) * Number(stats.bsize) }))
    .catch(() => null);
  const total = os.totalmem();
  const constrained = typeof process.constrainedMemory === 'function' ? Number(process.constrainedMemory()) : 0;
  const cpu = os.cpus()[0]?.model?.replace(/\s+/g, ' ').trim();
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    os: { platform: process.platform, name: osName(), release: limit(os.release(), 80), arch: process.arch },
    runtime: runtime(),
    cpu: {
      model: cpu ? limit(cpu, 80) : null,
      cores: typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length,
      load: process.platform === 'win32' ? null : os.loadavg().map((value) => Math.round(value * 100) / 100),
    },
    memory: {
      total,
      free: os.freemem(),
      limit: constrained > 0 && constrained < total ? constrained : null,
      process: process.memoryUsage.rss(),
    },
    disk,
    uptime: { system: Math.round(os.uptime()), process: Math.round(process.uptime()) },
    container: detectContainer(),
    locale: limit(resolved.locale || 'und', 24),
    timezone: limit(process.env.TZ || resolved.timeZone || 'UTC', 48),
  };
}

function toError(value: unknown) {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object' && 'message' in value) {
    const error = new Error(String((value as { message: unknown }).message));
    error.name = String((value as { name?: unknown }).name ?? 'NonError');
    return error;
  }
  const error = new Error(typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)));
  error.name = 'NonError';
  return error;
}

function rawStack(error: Error, clean: Cleaner) {
  const parts = [limit(String(error.stack ?? `${error.name}: ${error.message}`), 12_000)];
  let cause = (error as { cause?: unknown }).cause;
  for (let depth = 0; cause && depth < 3; depth++) {
    const next = toError(cause);
    parts.push(`Caused by: ${limit(String(next.stack ?? `${next.name}: ${next.message}`), 4000)}`);
    cause = (next as { cause?: unknown }).cause;
  }
  return limit(clean(parts.join('\n')), 8000);
}

export function buildEvent(
  value: unknown,
  options: { version: string; level: Level; context?: Facts; handled: boolean; origin: string; root?: string; clean?: Cleaner }
): ErrorEvent {
  const error = toError(value);
  const clean = options.clean ?? scrubber({ root: options.root });
  const type = limit(String(error.name || error.constructor?.name || 'Error').replace(/[^\w.$-]/g, '') || 'Error', 80);
  const rawCode = (error as { code?: unknown }).code;
  return {
    id: randomUUID(),
    time: Date.now(),
    level: options.level,
    type,
    code: typeof rawCode === 'string' && /^[\w.:-]{1,40}$/.test(rawCode) ? rawCode : null,
    message: limit(clean(limit(String(error.message ?? ''), 4000)), 1000),
    frames: parseStack(limit(String(error.stack ?? ''), 12_000), options.root, clean),
    raw: rawStack(error, clean),
    count: 1,
    version: options.version,
    context: cleanFacts(options.context, clean, 20),
    handled: options.handled,
    origin: limit(options.origin, 40),
  };
}

export function describe(language: 'de' | 'en' = 'de', app = 'diese App') {
  if (language === 'en') {
    return {
      title: 'Usage statistics and error reports',
      summary: `Helps MoeStudio see how many servers run ${app} and which errors occur. No content, names, email or IP addresses are stored.`,
      stats: [
        'A random installation ID that is not linked to you or your server',
        'App version, installation type and runtime, for example the Node.js version',
        'Operating system, architecture, CPU cores, memory and free disk space',
        'Time zone and language of the server',
        'Counts such as accounts or files, never their content',
      ],
      errors: ['Error messages with the place in the code. Paths, addresses, email addresses and keys are removed before sending'],
      note: 'You can turn this off at any time and have the data deleted.',
    };
  }
  return {
    title: 'Nutzungsstatistik und Fehlerberichte',
    summary: `Hilft MoeStudio zu sehen, auf wie vielen Servern ${app} läuft und welche Fehler auftreten. Inhalte, Namen, E-Mail- und IP-Adressen werden nicht gespeichert.`,
    stats: [
      'Eine zufällige Installations-ID ohne Bezug zu dir oder deinem Server',
      'App-Version, Installationsart und Laufzeitumgebung, etwa die Node.js-Version',
      'Betriebssystem, Architektur, CPU-Kerne, Arbeitsspeicher und freier Speicherplatz',
      'Zeitzone und Sprache des Servers',
      'Anzahlen wie Konten oder Dateien, nie deren Inhalt',
    ],
    errors: ['Fehlermeldungen mit der Stelle im Programm. Pfade, Adressen, E-Mail-Adressen und Schlüssel werden vorher entfernt'],
    note: 'Du kannst das jederzeit abschalten und die Daten löschen lassen.',
  };
}

function normalizeConsent(value: unknown): Consent {
  if (value === true) return { ...FULL };
  if (value && typeof value === 'object') {
    const consent = value as Partial<Consent>;
    return { stats: consent.stats === true, errors: consent.errors === true };
  }
  return { ...NONE };
}

function jitter(ms: number) {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}

function versionParts(version: string) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([\w.-]+))?/.exec(String(version).trim());
  return match ? { parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], pre: match[4] ?? '' } : null;
}

export function compareVersions(a: string, b: string) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let index = 0; index < 3; index++)
    if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre, 'en', { numeric: true });
}

export function noticeMatches(notice: Pick<Notice, 'minVersion' | 'maxVersion'>, version: string) {
  if (notice.minVersion && compareVersions(version, notice.minVersion) < 0) return false;
  if (notice.maxVersion && compareVersions(version, notice.maxVersion) > 0) return false;
  return true;
}

export function workChallenge(install: string, time: number, subject: string, message: string) {
  return `MOEPULSE-WORK:${install}:${time}:${createHash('sha256').update(`${subject}\n${message}`).digest('hex')}`;
}

export function workBits(challenge: string, nonce: string) {
  const hash = createHash('sha256').update(`${challenge}:${nonce}`).digest();
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

async function solveWork(challenge: string, bits: number) {
  for (let counter = 0; ; counter++) {
    if (counter && counter % 4096 === 0) await new Promise((done) => setImmediate(done));
    if (workBits(challenge, String(counter)) >= bits) return String(counter);
  }
}

function secureEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

const VERSION_TEXT = /^v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?$/;

function cleanRelease(entry: unknown): Release | null {
  if (!entry || typeof entry !== 'object') return null;
  const data = entry as Record<string, unknown>;
  if (typeof data.version !== 'string' || data.version.length > 40 || !VERSION_TEXT.test(data.version)) return null;
  const text = (value: unknown, max: number) => (typeof value === 'string' && value ? value.slice(0, max) : null);
  return {
    version: data.version,
    title: text(data.title, 160),
    date: typeof data.date === 'number' && Number.isFinite(data.date) ? data.date : null,
    dateText: text(data.dateText, 60),
    url: typeof data.url === 'string' && /^https:\/\/[^\s]+$/.test(data.url) ? data.url.slice(0, 500) : null,
    security: data.security === true,
    channel: data.channel === 'beta' ? 'beta' : 'stable',
    notes: text(data.notes, 20_000),
  };
}

function cleanUpdate(body: Record<string, unknown>, app: string, version: string): UpdateInfo | null {
  if (body.ok !== true) return null;
  const releases = Array.isArray(body.releases)
    ? body.releases
        .map(cleanRelease)
        .filter((entry): entry is Release => entry !== null)
        .slice(0, 20)
    : [];
  return {
    app,
    version,
    channel: body.channel === 'beta' ? 'beta' : 'stable',
    latest: cleanRelease(body.latest),
    update: body.update === true,
    security: body.security === true,
    yanked: body.yanked === true,
    behind: typeof body.behind === 'number' ? Math.max(0, Math.floor(body.behind)) : releases.length,
    releases,
    checkedAt: typeof body.checkedAt === 'number' ? body.checkedAt : Date.now(),
  };
}

function cleanNotice(entry: unknown): Notice | null {
  if (!entry || typeof entry !== 'object') return null;
  const data = entry as Record<string, unknown>;
  const level = data.level === 'warning' || data.level === 'security' ? data.level : 'info';
  if (typeof data.id !== 'number' || typeof data.title !== 'string' || typeof data.body !== 'string') return null;
  const link = typeof data.link === 'string' && /^https:\/\/[^\s]+$/.test(data.link) ? data.link.slice(0, 500) : null;
  return {
    id: data.id,
    level,
    title: data.title.slice(0, 120),
    body: data.body.slice(0, 2000),
    link,
    minVersion: typeof data.minVersion === 'string' ? data.minVersion : null,
    maxVersion: typeof data.maxVersion === 'string' ? data.maxVersion : null,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  };
}

export function createPulse(options: PulseOptions): Pulse {
  const endpoint = (options.endpoint || process.env.MOEPULSE_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const stateDir = join(resolve(options.dataDir), 'moepulse');
  const identityFile = join(stateDir, 'identity.json');
  const root = resolve(options.root ?? process.cwd());
  const timeout = options.timeout ?? 10_000;
  const fetcher = options.fetch ?? globalThis.fetch;
  const started = Math.round((Date.now() - process.uptime() * 1000) / 1000) * 1000;
  const log = (level: 'debug' | 'warn', message: string) => {
    try {
      options.log?.(level, message);
    } catch {}
  };
  const insecure = !secureEndpoint(endpoint);
  const disabled = process.env.MOEPULSE_DISABLED === '1' || process.env.MOEPULSE_ENDPOINT === 'off' || insecure;
  if (insecure && process.env.MOEPULSE_ENDPOINT !== 'off') log('warn', `MoePulse bleibt aus: ${endpoint} ist keine HTTPS-Adresse.`);

  let consent: Consent = { ...NONE };
  let identity: Identity | null = null;
  let running = false;
  let blocked = false;
  let errorsAllowed = true;
  let interval = Math.min(Math.max(options.interval ?? 6 * HOUR, 15 * MINUTE), 24 * HOUR);
  let failures = 0;
  let skew = 0;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let flushTimer: NodeJS.Timeout | null = null;
  let lastHeartbeat: number | null = null;
  let lastError: string | null = null;
  let unreadTickets = 0;
  let knownNotices: Notice[] = [];
  let knownUpdate: UpdateSummary | null = null;
  let updateCache: { at: number; channel: string; info: UpdateInfo } | null = null;
  const defaultChannel = (): 'stable' | 'beta' =>
    options.channel && /^(beta|next|preview|rc)$/i.test(options.channel) ? 'beta' : 'stable';
  const recentErrors: Array<{
    type: string;
    code: string | null;
    message: string;
    fingerprint: string;
    at: number;
    count: number;
    version: string;
  }> = [];
  let hooked = false;
  let beating: Promise<void> | null = null;
  const queue = new Map<string, ErrorEvent & { file?: string }>();
  const sentAt: number[] = [];
  const counters = new Map<string, number>();

  const cleaner = () => {
    let extra: Array<string | RegExp> = [];
    try {
      extra = options.redact?.() ?? [];
    } catch {}
    return scrubber({ root, paths: { data: resolve(options.dataDir), ...options.paths }, extra });
  };

  async function loadIdentity(create: boolean): Promise<Identity | null> {
    if (identity) return identity;
    let text: string | null = null;
    try {
      text = options.identity ? await options.identity.load() : await readFile(identityFile, 'utf8').catch(() => null);
    } catch {
      text = null;
    }
    const parsed = parseIdentity(text);
    if (parsed) return (identity = parsed);
    if (!create) return null;
    const fresh = generateIdentity();
    const serialized = JSON.stringify({ v: 1, id: fresh.id, privateKey: fresh.secret, publicKey: fresh.publicKey, created: Date.now() });
    if (options.identity) {
      await options.identity.save(serialized);
      return (identity = parseIdentity(serialized));
    }
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    try {
      await writeFile(identityFile, serialized, { flag: 'wx', mode: 0o600 });
      return (identity = parseIdentity(serialized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return (identity = parseIdentity(await readFile(identityFile, 'utf8')));
    }
  }

  function parseIdentity(text: string | null): Identity | null {
    if (!text) return null;
    try {
      const data = JSON.parse(text) as { id?: string; privateKey?: string; publicKey?: string };
      if (!data.id || !ID.test(data.id) || !data.privateKey || !data.publicKey) return null;
      const key = createPrivateKey({ key: Buffer.from(data.privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
      return { id: data.id, key, publicKey: data.publicKey };
    } catch {
      return null;
    }
  }

  function generateIdentity() {
    const pair = generateKeyPairSync('ed25519');
    return {
      id: randomUUID(),
      secret: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url'),
      publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    };
  }

  async function dropIdentity() {
    identity = null;
    if (options.identity) await options.identity.clear?.();
    else await rm(identityFile, { force: true });
  }

  async function request(path: string, payload: unknown, retry = true): Promise<Reply | null> {
    const id = identity;
    if (!id || disabled) return null;
    const body = JSON.stringify(payload);
    const time = String(Date.now() + skew);
    const nonce = randomBytes(16).toString('base64url');
    const signature = sign(null, Buffer.from(canonical('POST', path, id.id, time, nonce, body)), id.key).toString('base64url');
    let response: Response;
    try {
      response = await fetcher(endpoint + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': `MoePulse/${SDK_VERSION} (${options.app}/${options.version}; ${runtime().name}/${runtime().version})`,
          'moepulse-install': id.id,
          'moepulse-time': time,
          'moepulse-nonce': nonce,
          'moepulse-signature': signature,
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      lastError = `Netzwerk: ${(error as Error).message}`;
      log('debug', `MoePulse nicht erreichbar: ${(error as Error).message}`);
      return null;
    }
    const reply = await readReply(response);
    if (response.status === 401 && reply.error === 'clock' && typeof reply.now === 'number' && retry) {
      skew = reply.now - Date.now();
      return request(path, payload, false);
    }
    if (response.status === 403 && reply.error === 'blocked') {
      blocked = true;
      halt();
      log('warn', 'MoePulse nimmt von dieser Installation keine Daten mehr an.');
    }
    if (response.status >= 400) lastError = `HTTP ${response.status}${typeof reply.error === 'string' ? ` ${reply.error}` : ''}`;
    return { status: response.status, body: reply };
  }

  async function readReply(response: Response): Promise<Record<string, unknown>> {
    try {
      if (Number(response.headers.get('content-length') ?? 0) > MAX_REPLY) return {};
      const text = await response.text();
      if (text.length > MAX_REPLY) return {};
      const value = JSON.parse(text) as unknown;
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  function absorb(body: Record<string, unknown>) {
    const support = body.support as { unread?: unknown } | undefined;
    if (support && typeof support.unread === 'number') unreadTickets = Math.max(0, Math.floor(support.unread));
    const update = body.update as Record<string, unknown> | null | undefined;
    if (update && typeof update === 'object' && typeof update.latest === 'string' && VERSION_TEXT.test(update.latest)) {
      knownUpdate = {
        latest: update.latest,
        update: update.update === true,
        security: update.security === true,
        yanked: update.yanked === true,
        url: typeof update.url === 'string' && /^https:\/\/[^\s]+$/.test(update.url) ? update.url : null,
      };
    }
    if (Array.isArray(body.notices))
      knownNotices = body.notices
        .map(cleanNotice)
        .filter((entry): entry is Notice => entry !== null)
        .slice(0, 20);
  }

  async function heartbeatPayload(scope: Consent): Promise<Heartbeat> {
    const id = identity ?? (await loadIdentity(false));
    const base: Heartbeat = {
      protocol: PROTOCOL,
      sdk: SDK_VERSION,
      key: id?.publicKey ?? '',
      app: options.app,
      version: options.version,
      channel: options.channel ?? null,
      install: options.install ?? null,
      scope: scope.stats ? 'full' : 'errors',
      started,
      runtime: runtime(),
    };
    if (!scope.stats) return base;
    const clean = cleaner();
    const [system, features, metrics] = await Promise.all([
      systemInfo(options.dataDir).catch(() => undefined),
      Promise.resolve()
        .then(() => options.features?.() ?? {})
        .catch(() => ({})),
      Promise.resolve()
        .then(() => options.metrics?.() ?? {})
        .catch(() => ({})),
    ]);
    return {
      ...base,
      system,
      features: cleanFacts(features, clean),
      metrics: cleanNumbers(metrics),
      counters: Object.fromEntries(counters),
    };
  }

  async function readConsent() {
    if (disabled) return { ...NONE };
    try {
      return normalizeConsent(await options.consent());
    } catch (error) {
      log('warn', `MoePulse: Einwilligung nicht lesbar (${(error as Error).message})`);
      return { ...NONE };
    }
  }

  function schedule(ms: number) {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => void tick(), ms);
    heartbeatTimer.unref();
  }

  async function tick() {
    consent = await readConsent();
    if (!consent.stats && !consent.errors) return halt();
    await heartbeat();
    if (running) schedule(failures ? Math.min(interval, MINUTE * 2 ** Math.min(failures, 8)) : jitter(interval));
  }

  async function heartbeat(): Promise<void> {
    if (beating) return beating;
    beating = (async () => {
      try {
        if (blocked) return;
        await loadIdentity(true);
        const payload = await heartbeatPayload(consent);
        const sent = { ...(payload.counters ?? {}) };
        let reply = await request('/v1/heartbeat', payload);
        if (reply?.status === 409 && reply.body.error === 'identity') {
          await dropIdentity();
          await loadIdentity(true);
          reply = await request('/v1/heartbeat', { ...payload, key: identity!.publicKey });
        }
        if (reply?.status === 200) {
          failures = 0;
          lastHeartbeat = Date.now();
          lastError = null;
          const next = Number(reply.body.interval);
          if (Number.isFinite(next) && next > 0) interval = Math.min(Math.max(next * 1000, 15 * MINUTE), 24 * HOUR);
          errorsAllowed = reply.body.errors !== false;
          absorb(reply.body);
          for (const [name, value] of Object.entries(sent)) {
            const left = (counters.get(name) ?? 0) - value;
            if (left > 0) counters.set(name, left);
            else counters.delete(name);
          }
          await sendCrashFiles();
        } else if (reply && (reply.status === 503 || reply.status === 429) && Number(reply.body.retry) > 0) {
          failures = 0;
          schedule(Math.max(Number(reply.body.retry) * 1000, MINUTE));
        } else if (reply?.status === 410) {
          blocked = true;
          halt();
          log('warn', `MoePulse kennt die App ${options.app} nicht und nimmt nichts an.`);
        } else {
          failures++;
        }
      } catch (error) {
        failures++;
        lastError = (error as Error).message;
        log('debug', `MoePulse: ${(error as Error).message}`);
      } finally {
        beating = null;
      }
    })();
    return beating;
  }

  function halt() {
    running = false;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (flushTimer) clearTimeout(flushTimer);
    heartbeatTimer = null;
    flushTimer = null;
    if (!consent.errors) queue.clear();
    if (!consent.stats) counters.clear();
  }

  function allowed() {
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] > HOUR) sentAt.shift();
    return sentAt.length < 60;
  }

  function remember(event: ErrorEvent, print: string) {
    const known = recentErrors.find((entry) => entry.fingerprint === print);
    if (known) {
      known.count += event.count;
      known.at = Math.max(known.at, event.time);
      return;
    }
    recentErrors.push({
      type: event.type,
      code: event.code,
      message: event.message,
      fingerprint: print,
      at: event.time,
      count: event.count,
      version: event.version,
    });
    if (recentErrors.length > 20) recentErrors.shift();
  }

  function enqueue(event: ErrorEvent & { file?: string }) {
    const print = fingerprint(event.type, event.message, event.frames);
    remember(event, print);
    if (disabled || blocked || !consent.errors || !errorsAllowed) return;
    const known = queue.get(print);
    if (known) {
      known.count += event.count;
      known.time = Math.max(known.time, event.time);
    } else {
      if (queue.size >= 30 || !allowed()) return;
      sentAt.push(Date.now());
      queue.set(print, event);
    }
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushQueue();
      }, 5000);
      flushTimer.unref();
    }
  }

  async function flushQueue(): Promise<void> {
    if (!queue.size || blocked) return;
    const batch = [...queue.entries()].slice(0, 20);
    for (const [print] of batch) queue.delete(print);
    try {
      if (!identity) {
        await loadIdentity(true);
        await heartbeat();
      }
      const events = batch.map(([, event]) => {
        const { file: _file, ...rest } = event;
        return rest;
      });
      let reply = await request('/v1/events', { protocol: PROTOCOL, app: options.app, events });
      if (reply?.status === 404 && reply.body.error === 'unknown') {
        await heartbeat();
        reply = await request('/v1/events', { protocol: PROTOCOL, app: options.app, events });
      }
      if (reply?.status === 200) {
        await Promise.all(batch.map(([, event]) => (event.file ? unlink(event.file).catch(() => {}) : undefined)));
      } else if (!reply || reply.status >= 500 || reply.status === 429) {
        for (const [print, event] of batch) if (queue.size < 30 && !queue.has(print)) queue.set(print, event);
      }
    } catch (error) {
      lastError = (error as Error).message;
    }
    if (queue.size && !flushTimer && running) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushQueue();
      }, MINUTE);
      flushTimer.unref();
    }
  }

  async function sendCrashFiles() {
    if (!consent.errors || options.crashes === false) return;
    const names = await readdir(stateDir).catch(() => [] as string[]);
    for (const name of names.filter((entry) => /^crash-[\w-]+\.json$/.test(entry)).slice(0, 10)) {
      const file = join(stateDir, name);
      try {
        if ((await stat(file)).size > MAX_REPLY) throw new Error('zu groß');
        const event = JSON.parse(await readFile(file, 'utf8')) as ErrorEvent;
        if (event && typeof event.id === 'string' && ID.test(event.id)) enqueue({ ...event, file });
        else await unlink(file);
      } catch {
        await unlink(file).catch(() => {});
      }
    }
  }

  function hook() {
    if (hooked || options.crashes === false) return;
    hooked = true;
    process.on('uncaughtExceptionMonitor', (error, origin) => {
      try {
        if (!consent.errors || blocked || disabled) return;
        const event = buildEvent(error, { version: options.version, level: 'fatal', handled: false, origin, root, clean: cleaner() });
        mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        const file = join(stateDir, `crash-${event.id}.json`);
        writeFileSync(file, JSON.stringify(event), { mode: 0o600 });
        enqueue({ ...event, file });
      } catch {}
    });
  }

  async function activate() {
    consent = await readConsent();
    if (!consent.stats && !consent.errors) {
      halt();
      return;
    }
    if (running) return;
    running = true;
    await heartbeat();
    if (running) schedule(failures ? MINUTE * 2 : jitter(interval));
  }

  function supportError(reply: Reply | null): PulseError {
    if (!reply) return new PulseError('network', SUPPORT_ERRORS.network);
    const code = typeof reply.body.error === 'string' ? reply.body.error : 'server';
    const known: Record<string, string> = { unknown: 'missing', not_found: 'missing', app_paused: 'paused' };
    const mapped = known[code] ?? code;
    const retry = typeof reply.body.retry === 'number' ? reply.body.retry : typeof reply.body.bits === 'number' ? reply.body.bits : null;
    return new PulseError(mapped, SUPPORT_ERRORS[mapped] ?? `MoeStudio antwortet mit Fehler ${reply.status}.`, reply.status, retry);
  }

  async function supportCall(path: string, payload: Record<string, unknown>, create = false) {
    if (disabled) throw new PulseError('disabled', SUPPORT_ERRORS.disabled);
    if (blocked) throw new PulseError('blocked', SUPPORT_ERRORS.blocked);
    const id = identity ?? (await loadIdentity(create));
    if (!id) return null;
    const reply = await request(path, { protocol: PROTOCOL, app: options.app, ...payload });
    if (reply?.status === 200) {
      absorb(reply.body);
      return reply.body;
    }
    throw supportError(reply);
  }

  async function diagnostics() {
    const clean = cleaner();
    const [system, features, metrics] = await Promise.all([
      systemInfo(options.dataDir).catch(() => undefined),
      Promise.resolve()
        .then(() => options.features?.() ?? {})
        .catch(() => ({})),
      Promise.resolve()
        .then(() => options.metrics?.() ?? {})
        .catch(() => ({})),
    ]);
    return {
      install: options.install ?? null,
      channel: options.channel ?? null,
      runtime: runtime(),
      system,
      features: cleanFacts(features, clean),
      metrics: cleanNumbers(metrics),
      errors: recentErrors.slice(-10).map((entry) => ({ ...entry })),
      consent: { ...consent },
    };
  }

  const support: Support = {
    async create(input) {
      const subject = String(input.subject ?? '')
        .trim()
        .slice(0, 120);
      const message = String(input.message ?? '')
        .trim()
        .slice(0, 5000);
      if (subject.length < 3 || message.length < 10) throw new PulseError('invalid', SUPPORT_ERRORS.invalid);
      await loadIdentity(true);
      const base = {
        key: identity!.publicKey,
        sdk: SDK_VERSION,
        version: options.version,
        runtime: runtime(),
        subject,
        message,
        category: input.category ?? 'question',
        name: input.name?.trim().slice(0, 80) || null,
        email: input.email?.trim().slice(0, 200) || null,
        diagnostics: input.diagnostics ? await diagnostics() : null,
      };
      let bits = 16;
      for (let attempt = 0; attempt < 3; attempt++) {
        const time = Date.now() + skew;
        const challenge = workChallenge(identity!.id, time, subject, message);
        const nonce = bits > 0 ? await solveWork(challenge, bits) : '0';
        try {
          const body = await supportCall('/v1/tickets/create', { ...base, work: { time, nonce } }, true);
          return body!.ticket as TicketDetail;
        } catch (error) {
          if (error instanceof PulseError && error.code === 'work' && attempt < 2) {
            bits = Math.min(Math.max(Number(error.retry ?? bits + 2), 0), 26);
            continue;
          }
          throw error;
        }
      }
      throw new PulseError('work', SUPPORT_ERRORS.limited);
    },
    async list() {
      const body = await supportCall('/v1/tickets/list', {});
      if (!body) return { tickets: [], unread: 0 };
      return { tickets: (body.tickets as Ticket[]) ?? [], unread: unreadTickets };
    },
    async get(ticket) {
      const body = await supportCall('/v1/tickets/get', { id: ticket });
      if (!body) throw new PulseError('missing', SUPPORT_ERRORS.missing);
      return body.ticket as TicketDetail;
    },
    async reply(ticket, message) {
      const text = String(message ?? '')
        .trim()
        .slice(0, 5000);
      if (!text) throw new PulseError('invalid', SUPPORT_ERRORS.invalid);
      const body = await supportCall('/v1/tickets/reply', { id: ticket, message: text });
      if (!body) throw new PulseError('missing', SUPPORT_ERRORS.missing);
      return body.ticket as TicketDetail;
    },
    async close(ticket) {
      const body = await supportCall('/v1/tickets/close', { id: ticket });
      if (!body) throw new PulseError('missing', SUPPORT_ERRORS.missing);
      return body.ticket as TicketDetail;
    },
    unread: () => unreadTickets,
  };

  return {
    support,
    notices: () => knownNotices.filter((notice) => noticeMatches(notice, options.version)),
    async fetchNotices() {
      if (disabled) return [];
      try {
        const response = await fetcher(`${endpoint}/v1/notices/${encodeURIComponent(options.app)}`, {
          headers: { accept: 'application/json', 'user-agent': `MoePulse/${SDK_VERSION}` },
          redirect: 'error',
          signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) return knownNotices.filter((notice) => noticeMatches(notice, options.version));
        const body = await readReply(response);
        if (Array.isArray(body.notices))
          knownNotices = body.notices
            .map(cleanNotice)
            .filter((entry): entry is Notice => entry !== null)
            .slice(0, 20);
      } catch (error) {
        lastError = `Netzwerk: ${(error as Error).message}`;
      }
      return knownNotices.filter((notice) => noticeMatches(notice, options.version));
    },
    update: () => (knownUpdate ? { ...knownUpdate } : null),
    async checkUpdate(check = {}) {
      if (disabled) return null;
      const channel = check.channel ?? defaultChannel();
      if (!check.force && updateCache && updateCache.channel === channel && Date.now() - updateCache.at < 10 * MINUTE)
        return updateCache.info;
      try {
        const query = new URLSearchParams({ version: options.version, channel });
        const response = await fetcher(`${endpoint}/v1/updates/${encodeURIComponent(options.app)}?${query}`, {
          headers: { accept: 'application/json', 'user-agent': `MoePulse/${SDK_VERSION}` },
          redirect: 'error',
          signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) {
          lastError = `HTTP ${response.status} bei der Versionsprüfung`;
          return updateCache?.info ?? null;
        }
        const info = cleanUpdate(await readReply(response), options.app, options.version);
        if (!info) return updateCache?.info ?? null;
        updateCache = { at: Date.now(), channel, info };
        knownUpdate = info.latest
          ? { latest: info.latest.version, update: info.update, security: info.security, yanked: info.yanked, url: info.latest.url }
          : knownUpdate;
        return info;
      } catch (error) {
        lastError = `Netzwerk: ${(error as Error).message}`;
        return updateCache?.info ?? null;
      }
    },
    async start() {
      hook();
      await activate().catch((error) => log('debug', `MoePulse: ${(error as Error).message}`));
    },
    async refresh() {
      const before = running;
      await activate().catch(() => {});
      if (before && running) await heartbeat();
    },
    async stop() {
      await flushQueue().catch(() => {});
      running = false;
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (flushTimer) clearTimeout(flushTimer);
      heartbeatTimer = null;
      flushTimer = null;
    },
    capture(error, context, level = 'error') {
      try {
        enqueue(buildEvent(error, { version: options.version, level, context, handled: true, origin: 'capture', root, clean: cleaner() }));
      } catch {}
    },
    message(text, context, level = 'warning') {
      try {
        const error = new Error(text);
        error.name = 'Message';
        error.stack = `Message: ${text}`;
        enqueue(buildEvent(error, { version: options.version, level, context, handled: true, origin: 'message', root, clean: cleaner() }));
      } catch {}
    },
    count(name, by = 1) {
      if (!consent.stats || !KEY_NAME.test(name) || !Number.isFinite(by)) return;
      if (!counters.has(name) && counters.size >= 50) return;
      counters.set(name, (counters.get(name) ?? 0) + by);
    },
    async flush(wait = 3000) {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      await Promise.race([flushQueue(), new Promise((done) => setTimeout(done, wait).unref())]);
    },
    async preview(scope) {
      const id = identity ?? (await loadIdentity(false));
      const wanted = { stats: scope?.stats ?? true, errors: scope?.errors ?? true };
      return { endpoint, installId: id?.id ?? null, heartbeat: await heartbeatPayload(wanted) };
    },
    status() {
      return {
        consent: { ...consent },
        running,
        interval,
        installId: identity?.id ?? null,
        lastHeartbeat,
        lastError,
        queued: queue.size,
        blocked,
      };
    },
    async forget() {
      const id = identity ?? (await loadIdentity(false));
      halt();
      queue.clear();
      counters.clear();
      if (!id) return true;
      const reply = await request('/v1/forget', { protocol: PROTOCOL, app: options.app });
      const done = reply !== null && (reply.status === 200 || reply.status === 404);
      if (done) {
        await dropIdentity();
        const names = await readdir(stateDir).catch(() => [] as string[]);
        await Promise.all(names.filter((name) => name.startsWith('crash-')).map((name) => unlink(join(stateDir, name)).catch(() => {})));
        blocked = false;
      }
      return done;
    },
  };
}

export interface SupportReply {
  status: number;
  body: Record<string, unknown>;
}

const REPLY_STATUS: Record<string, number> = {
  invalid: 400,
  app: 410,
  blocked: 403,
  missing: 404,
  limited: 429,
  work: 429,
  disabled: 503,
  paused: 503,
  network: 502,
};

const CATEGORIES: TicketCategory[] = ['bug', 'question', 'idea', 'other'];

export async function handleSupport(pulse: Pulse, input: unknown): Promise<SupportReply> {
  const request = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const id = typeof request.id === 'string' ? request.id.slice(0, 40) : '';
  try {
    switch (request.action) {
      case 'list':
        return { status: 200, body: { ...(await pulse.support.list()) } };
      case 'get':
        return { status: 200, body: { ...(await pulse.support.get(id)) } };
      case 'reply':
        return { status: 200, body: { ...(await pulse.support.reply(id, typeof request.message === 'string' ? request.message : '')) } };
      case 'close':
        return { status: 200, body: { ...(await pulse.support.close(id)) } };
      case 'notices':
        return { status: 200, body: { notices: pulse.status().running ? pulse.notices() : await pulse.fetchNotices() } };
      case 'update':
        return { status: 200, body: { update: await pulse.checkUpdate({ force: request.force === true }) } };
      case 'create': {
        const raw = request.input && typeof request.input === 'object' ? (request.input as Record<string, unknown>) : {};
        const ticket = await pulse.support.create({
          subject: typeof raw.subject === 'string' ? raw.subject : '',
          message: typeof raw.message === 'string' ? raw.message : '',
          category: CATEGORIES.includes(raw.category as TicketCategory) ? (raw.category as TicketCategory) : 'question',
          name: typeof raw.name === 'string' ? raw.name : undefined,
          email: typeof raw.email === 'string' ? raw.email : undefined,
          diagnostics: raw.diagnostics === true,
        });
        return { status: 200, body: { ...ticket } };
      }
      default:
        return { status: 400, body: { error: 'invalid', message: SUPPORT_ERRORS.invalid } };
    }
  } catch (error) {
    if (error instanceof PulseError) {
      const status = REPLY_STATUS[error.code] ?? (error.status >= 400 ? error.status : 502);
      return { status, body: { error: error.code, message: error.message, retry: error.retry } };
    }
    return { status: 500, body: { error: 'server', message: 'Da ist etwas schiefgegangen.' } };
  }
}
