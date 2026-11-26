import { readFile } from 'node:fs/promises';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, HttpError, notFound, tooLarge } from '../lib/errors.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { log } from '../lib/log.ts';
import { blobPath } from '../services/blobs.ts';
import { requireAccess } from '../services/nodes.ts';
import { notify } from '../services/notify.ts';
import * as settings from '../services/settings.ts';
import { zoneOf, type UserRow } from '../services/users.ts';
import { one } from '../lib/db.ts';
import { announceCalendars, insertCalendar, requireCalendar, validColor } from './calendars.ts';
import { davSession, davUrl, discoverCalendars, DavClientError, fetchCalendarData } from './davclient.ts';
import { fetchText, RemoteError } from './remote.ts';
import { fromCalendarTexts, fromFile, fromIcs, SOURCE_LIMITS, SourceError, type Source } from './sources.ts';
import { importInto, type ImportMode, type ImportResult } from './transfer.ts';

type Problem = { message: string; params?: Record<string, string | number>; subject?: string };

export interface ImportChoice {
  key: string;
  target: 'new' | 'skip' | string;
  name?: string;
  color?: string;
}

interface JobResult extends ImportResult {
  key: string;
  calendarId: string;
  name: string;
  color: string;
  created_calendar: boolean;
}

interface ImportJob {
  id: string;
  userId: number;
  kind: 'file' | 'url' | 'caldav';
  label: string;
  status: 'reading' | 'ready' | 'importing' | 'done' | 'failed';
  sources: Source[];
  warnings: Problem[];
  error: Problem | null;
  results: JobResult[] | null;
  createdAt: number;
  finishedAt: number | null;
}

const KEEP = 30 * 60 * 1000;
const PER_USER = 3;
const jobs = new Map<string, ImportJob>();
const pending = new Map<string, Promise<void>>();

export const calendarImportsSettled = () => Promise.all([...pending.values()]);

const allowPrivate = () => settings.get('calendar.subscriptionsPrivate') || settings.get('import.private');

function tidy(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (now - job.createdAt > KEEP && job.status !== 'reading' && job.status !== 'importing') jobs.delete(id);
  }
}

function problemOf(error: unknown): Problem {
  if (error instanceof SourceError || error instanceof DavClientError) return { message: error.message, params: error.params };
  if (error instanceof RemoteError) return { message: error.message, params: error.params };
  if (error instanceof HttpError) return { message: error.message, params: error.params as Record<string, string | number> };
  log.warn({ error: (error as Error).message }, 'Kalenderimport fehlgeschlagen');
  return { message: 'Beim Lesen ist etwas schiefgegangen' };
}

function newJob(user: UserRow, kind: ImportJob['kind'], label: string): ImportJob {
  tidy();
  const mine = [...jobs.values()].filter((job) => job.userId === user.id);
  if (mine.some((job) => job.status === 'reading' || job.status === 'importing'))
    throw conflict('Es läuft schon ein Import, warte, bis er fertig ist');
  for (const job of mine.sort((a, b) => a.createdAt - b.createdAt).slice(0, Math.max(0, mine.length - PER_USER + 1))) jobs.delete(job.id);
  const job: ImportJob = {
    id: randomId(16),
    userId: user.id,
    kind,
    label,
    status: 'reading',
    sources: [],
    warnings: [],
    error: null,
    results: null,
    createdAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  return job;
}

function settle(job: ImportJob, sources: Source[]) {
  const total = sources.reduce((sum, source) => sum + source.events + source.tasks, 0);
  if (sources.length > SOURCE_LIMITS.calendars) {
    job.warnings.push({ message: 'Nur die ersten {count} Kalender werden angezeigt', params: { count: SOURCE_LIMITS.calendars } });
    sources = sources.slice(0, SOURCE_LIMITS.calendars);
  }
  if (total > SOURCE_LIMITS.objects)
    throw new SourceError('Das sind mehr als {count} Einträge auf einmal', { count: SOURCE_LIMITS.objects });
  job.sources = sources;
  if (!sources.length) {
    job.status = 'failed';
    job.error = job.warnings.shift() ?? { message: 'MoeCloud hat darin keine Termine oder Aufgaben gefunden' };
  } else job.status = 'ready';
  job.finishedAt = Date.now();
}

function fail(job: ImportJob, error: unknown) {
  job.status = 'failed';
  job.error = problemOf(error);
  job.sources = [];
  job.finishedAt = Date.now();
}

export async function startFileImport(user: UserRow, files: { name: string; data: Buffer }[]) {
  if (!files.length) throw badRequest('Wähl mindestens eine Datei aus');
  if (files.length > SOURCE_LIMITS.files) throw badRequest('Höchstens {count} Dateien auf einmal', { count: SOURCE_LIMITS.files });
  const bytes = files.reduce((sum, file) => sum + file.data.length, 0);
  if (bytes > SOURCE_LIMITS.bytes) throw tooLarge('Die Dateien sind zusammen zu groß');
  const job = newJob(user, 'file', files.length === 1 ? files[0].name : `${files.length}`);
  const zone = zoneOf(user);
  const sources: Source[] = [];
  try {
    for (const [index, file] of files.entries()) {
      try {
        sources.push(...(await fromFile(file.name, file.data, zone, `f${index}`)));
      } catch (error) {
        if (!(error instanceof SourceError)) throw error;
        job.warnings.push(problemOf(error));
      }
    }
    settle(job, sources);
  } catch (error) {
    fail(job, error);
  }
  return job;
}

export async function startNodeImport(user: UserRow, nodeId: string) {
  const { node } = requireAccess(user, nodeId, 'view');
  if (node.type !== 'file' || !node.sha256) throw badRequest('Das ist keine Datei');
  if ((node.size ?? 0) > SOURCE_LIMITS.file) throw tooLarge('Die Datei ist zu groß zum Importieren');
  const blob = one<{ scan_status: string | null }>('SELECT scan_status FROM blobs WHERE sha256 = ?', node.sha256);
  if (blob?.scan_status === 'infected') throw forbidden('Die Datei enthält Schadsoftware');
  const data = await readFile(blobPath(node.sha256)).catch(() => {
    throw notFound('Diese Datei gibt es nicht mehr');
  });
  return startFileImport(user, [{ name: node.name, data }]);
}

function remoteAllowed() {
  if (!settings.get('calendar.imports')) throw forbidden('Importe aus anderen Diensten sind auf diesem Server ausgeschaltet');
}

export function startUrlImport(user: UserRow, input: string) {
  remoteAllowed();
  let host: string;
  try {
    host = new URL(input.trim().replace(/^webcals?:\/\//i, 'https://')).hostname;
  } catch {
    throw badRequest('Die Adresse sieht nicht richtig aus');
  }
  const job = newJob(user, 'url', host);
  const zone = zoneOf(user);
  const work = (async () => {
    try {
      const remote = await fetchText(input, { allowPrivate: allowPrivate(), limit: SOURCE_LIMITS.file, timeout: 45_000 });
      const source = fromIcs(remote.text, host, zone, 'u0');
      settle(job, source ? [source] : []);
    } catch (error) {
      fail(job, error);
    }
  })().finally(() => pending.delete(job.id));
  pending.set(job.id, work);
  return job;
}

export function startCaldavImport(user: UserRow, input: { url: string; username: string; password: string }) {
  remoteAllowed();
  const url = (() => {
    try {
      return davUrl(input.url);
    } catch (error) {
      throw badRequest((error as Error).message);
    }
  })();
  if (!input.username.trim() || !input.password) throw badRequest('Gib Benutzername und Passwort an');
  const job = newJob(user, 'caldav', url.host);
  const zone = zoneOf(user);
  const session = davSession(url, input.username.trim(), input.password, allowPrivate());
  const work = (async () => {
    try {
      const calendars = await discoverCalendars(session, url);
      const sources: Source[] = [];
      let budget = SOURCE_LIMITS.bytes;
      for (const [index, calendar] of calendars.slice(0, SOURCE_LIMITS.calendars).entries()) {
        try {
          const { texts, bytes } = await fetchCalendarData(session, calendar, budget);
          budget -= bytes;
          const source = fromCalendarTexts(texts, calendar.name, zone, `c${index}`, calendar);
          if (source) sources.push(source);
        } catch (error) {
          if (!(error instanceof DavClientError)) throw error;
          job.warnings.push({ ...problemOf(error), subject: calendar.name });
          if (budget <= 0) break;
        }
      }
      if (!sources.length && !job.warnings.length) job.warnings.push({ message: 'Die Kalender auf dem Server sind leer' });
      settle(job, sources);
    } catch (error) {
      fail(job, error);
    }
  })().finally(() => pending.delete(job.id));
  pending.set(job.id, work);
  return job;
}

export function getImport(user: UserRow, id: string) {
  tidy();
  const job = jobs.get(id);
  if (!job || job.userId !== user.id) throw notFound('Diesen Import gibt es nicht mehr');
  return job;
}

export function discardImport(user: UserRow, id: string) {
  const job = getImport(user, id);
  if (job.status === 'importing') throw conflict('Der Import läuft gerade');
  jobs.delete(job.id);
}

export async function runImport(user: UserRow, id: string, choices: ImportChoice[], mode: ImportMode) {
  const job = getImport(user, id);
  if (job.status !== 'ready') throw conflict('Dieser Import ist nicht bereit');
  const wanted = choices.filter((choice) => choice.target !== 'skip');
  if (!wanted.length) throw badRequest('Wähl mindestens einen Kalender aus');
  const sources = new Map(job.sources.map((source) => [source.key, source]));
  for (const choice of wanted) {
    if (!sources.has(choice.key)) throw badRequest('Diesen Kalender gibt es im Import nicht');
    if (choice.target !== 'new') requireCalendar(user, choice.target, 'write');
  }
  job.status = 'importing';
  const results: JobResult[] = [];
  try {
    for (const choice of wanted) {
      const source = sources.get(choice.key)!;
      const fresh = choice.target === 'new';
      const calendar = fresh
        ? insertCalendar(user, {
            name: choice.name?.trim() || source.name,
            color: validColor(choice.color) ? choice.color : (source.color ?? undefined),
            description: source.description,
            zone: source.zone,
          })
        : requireCalendar(user, choice.target, 'write').calendar;
      const result = importInto(user, calendar, source.text, mode);
      results.push({
        ...result,
        key: source.key,
        calendarId: calendar.id,
        name: calendar.name,
        color: calendar.color,
        created_calendar: fresh,
      });
      await yieldLoop();
    }
  } finally {
    announceCalendars([user.id]);
    job.results = results;
    job.sources = [];
    job.status = 'done';
    job.finishedAt = Date.now();
  }
  const created = results.reduce((sum, result) => sum + result.created, 0);
  const updated = results.reduce((sum, result) => sum + result.updated, 0);
  if (created + updated > 50) {
    notify(
      user.id,
      'calendar_import',
      {
        name: results.length === 1 ? results[0].name : `${results.length}`,
        created,
        updated,
        skipped: results.reduce((sum, result) => sum + result.skipped, 0),
      },
      '/calendar',
      { mail: false, push: false }
    );
  }
  return job;
}

export function presentImport(job: ImportJob, lang: Lang) {
  const text = (problem: Problem) => {
    const said = t(lang, problem.message, problem.params);
    return problem.subject ? `${problem.subject}: ${said}` : said;
  };
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    calendars: job.sources.map((source) => ({
      key: source.key,
      name: source.name,
      color: source.color,
      description: source.description,
      origin: source.origin,
      events: source.events,
      tasks: source.tasks,
      first: source.first,
      last: source.last,
    })),
    warnings: job.warnings.map(text),
    error: job.error ? text(job.error) : null,
    results:
      job.results?.map((result) => ({
        key: result.key,
        calendarId: result.calendarId,
        name: result.name,
        color: result.color,
        createdCalendar: result.created_calendar,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
      })) ?? null,
  };
}
