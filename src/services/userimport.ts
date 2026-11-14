import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../lib/errors.ts';
import { isLang, t, type Lang } from '../lib/i18n.ts';
import { displayName, email, password, username } from '../lib/validate.ts';
import { audit } from './audit.ts';
import { mailReady } from './mail.ts';
import { sendResetByAdmin } from './resets.ts';
import { createUser, keyOf, type UserRow } from './users.ts';
import { all } from '../lib/db.ts';

export const IMPORT_LIMIT = 500;

type Field = 'username' | 'name' | 'email' | 'role' | 'quota' | 'password' | 'language';

const HEADERS: Record<string, Field> = {
  username: 'username',
  benutzername: 'username',
  login: 'username',
  user: 'username',
  name: 'name',
  anzeigename: 'name',
  displayname: 'name',
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  role: 'role',
  rolle: 'role',
  quota: 'quota',
  speicher: 'quota',
  speicherplatz: 'quota',
  password: 'password',
  passwort: 'password',
  language: 'language',
  sprache: 'language',
};

const UNITS: Record<string, number> = { '': 1, b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };

export interface PlannedUser {
  line: number;
  username: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  quota: number | null;
  password: string | null;
  language: Lang | null;
}

export interface ImportLine {
  line: number;
  username: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  quota: number | null;
  status: 'ready' | 'created' | 'skipped' | 'error';
  message: string | null;
  sent?: boolean;
}

export function parseCsv(text: string) {
  const source = text.replace(/^\uFEFF/, '');
  const end = source.search(/\r?\n/);
  const head = end === -1 ? source : source.slice(0, end);
  const separator =
    (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : head.includes('\t') && !head.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((cells) => cells.map((value) => value.trim())).filter((cells) => cells.some(Boolean));
}

function sizeOf(value: string) {
  if (!value) return null;
  const match = /^(\d+(?:[.,]\d+)?)\s*([kmgt]?b)?$/i.exec(value.replace(/\s+/g, ' ').trim());
  if (!match) return undefined;
  return Math.round(Number(match[1].replace(',', '.')) * UNITS[(match[2] ?? '').toLowerCase()]);
}

const roleOf = (value: string) => {
  const key = value.toLowerCase();
  if (!key || ['user', 'mitglied', 'member', 'benutzer'].includes(key)) return 'user';
  if (['admin', 'administrator', 'verwaltung'].includes(key)) return 'admin';
  return null;
};

const first = (schema: z.ZodType, value: unknown) => {
  const result = schema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? 'Die Eingabe ist ungültig');
};

export function planImport(text: string, sendLinks: boolean, lang: Lang) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw badRequest('Die Datei braucht eine Kopfzeile und mindestens eine Person');
  const fields = rows[0].map((header) => HEADERS[header.toLowerCase().replace(/[\s_]/g, '')] ?? null);
  if (!fields.includes('username') || !fields.includes('name')) {
    throw badRequest('Die Kopfzeile braucht mindestens die Spalten username und name');
  }
  if (rows.length - 1 > IMPORT_LIMIT) throw badRequest('Höchstens {count} Personen auf einmal', { count: IMPORT_LIMIT });
  const taken = new Set(all<{ username_key: string }>('SELECT username_key FROM users').map((row) => row.username_key));
  const mails = new Set(
    all<{ email_key: string | null }>('SELECT email_key FROM users WHERE email_key IS NOT NULL').map((row) => row.email_key)
  );
  const seen = new Set<string>();
  const seenMails = new Set<string>();
  const mail = mailReady();
  return rows.slice(1).map((cells, index) => {
    const value = (field: Field) => {
      const column = fields.indexOf(field);
      return column === -1 ? '' : (cells[column] ?? '');
    };
    const planned: PlannedUser = {
      line: index + 2,
      username: value('username'),
      name: value('name') || value('username'),
      email: value('email'),
      role: roleOf(value('role')) ?? 'user',
      quota: null,
      password: value('password') || null,
      language: null,
    };
    const shown: ImportLine = {
      line: planned.line,
      username: planned.username,
      name: planned.name,
      email: planned.email,
      role: planned.role,
      quota: null,
      status: 'ready',
      message: null,
    };
    const fail = (message: string, status: 'error' | 'skipped' = 'error') => ({ shown: { ...shown, status, message }, planned: null });
    const quota = sizeOf(value('quota'));
    if (quota === undefined) return fail(t(lang, 'Der Speicherplatz ist keine Größe wie 10 GB'));
    planned.quota = quota;
    shown.quota = quota;
    const language = value('language').toLowerCase();
    if (language && !isLang(language)) return fail(t(lang, 'Als Sprache gehen de und en'));
    planned.language = language ? (language as Lang) : null;
    if (!roleOf(value('role'))) return fail(t(lang, 'Als Rolle gehen user und admin'));
    const problem =
      first(username, planned.username) ??
      first(displayName, planned.name) ??
      first(email, planned.email) ??
      (planned.password ? first(password, planned.password) : null);
    if (problem) return fail(t(lang, problem));
    const key = keyOf(planned.username);
    if (taken.has(key)) return fail(t(lang, 'Den Benutzernamen gibt es schon'), 'skipped');
    if (seen.has(key)) return fail(t(lang, 'Der Benutzername steht mehrfach in der Datei'));
    const mailKey = planned.email ? keyOf(planned.email) : null;
    if (mailKey && mails.has(mailKey)) return fail(t(lang, 'Die E-Mail-Adresse wird schon genutzt'), 'skipped');
    if (mailKey && seenMails.has(mailKey)) return fail(t(lang, 'Die E-Mail-Adresse steht mehrfach in der Datei'));
    if (!planned.password && !(sendLinks && mail && planned.email)) {
      return fail(
        mail
          ? t(lang, 'Ohne Passwort braucht es eine E-Mail-Adresse und den Link per E-Mail')
          : t(lang, 'Ohne E-Mail-Versand braucht jede Person ein Passwort')
      );
    }
    seen.add(key);
    if (mailKey) seenMails.add(mailKey);
    return { shown, planned };
  });
}

export async function runImport(request: FastifyRequest, actor: UserRow, text: string, sendLinks: boolean) {
  const plan = planImport(text, sendLinks, request.lang);
  const lines: ImportLine[] = [];
  let created = 0;
  for (const entry of plan) {
    if (!entry.planned) {
      lines.push(entry.shown);
      continue;
    }
    try {
      const user = await createUser({
        username: entry.planned.username,
        name: entry.planned.name,
        email: entry.planned.email || null,
        password: entry.planned.password,
        role: entry.planned.role,
        quota: entry.planned.quota,
        language: entry.planned.language,
      });
      created++;
      let sent = false;
      if (!entry.planned.password && user.email) {
        await sendResetByAdmin(request, actor, user);
        sent = true;
      }
      lines.push({ ...entry.shown, status: 'created', sent });
    } catch (error) {
      lines.push({ ...entry.shown, status: 'error', message: t(request.lang, (error as Error).message) });
    }
  }
  if (created) audit('users_imported', { actor: actor.id, request, details: { count: created } });
  return { lines, created };
}
