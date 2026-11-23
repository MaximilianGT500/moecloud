import { z } from 'zod';
import { randomId, sha256 } from '../lib/crypto.ts';
import { csvDocument, csvRow } from '../lib/csv.ts';
import { all, one, run, tx, value } from '../lib/db.ts';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { t, type Lang } from '../lib/i18n.ts';
import { notifyMerged } from './notify.ts';
import * as settings from './settings.ts';
import { getUser, inactive, type UserRow } from './users.ts';

export const QUESTION_KINDS = ['text', 'longtext', 'email', 'number', 'date', 'single', 'multiple', 'scale'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export type FormState = 'open' | 'closed' | 'ended' | 'full';

export const FORM_LIMITS = { questions: 100, options: 50, text: 1000, longtext: 4000, responses: 50_000 };

const ID = /^[A-Za-z0-9_-]{1,24}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,63}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER = /^-?\d{1,12}(?:[.,]\d{1,6})?$/;

const option = z.object({ id: z.string().regex(ID), label: z.string().trim().max(200) });

const question = z.object({
  id: z.string().regex(ID),
  kind: z.enum(QUESTION_KINDS),
  title: z.string().trim().max(500),
  description: z.string().max(2000).default(''),
  required: z.boolean().default(false),
  options: z.array(option).max(FORM_LIMITS.options).default([]),
  min: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable().default(null),
  max: z.number().int().min(-1_000_000_000).max(1_000_000_000).nullable().default(null),
  low: z.string().trim().max(60).default(''),
  high: z.string().trim().max(60).default(''),
});

export type Question = z.infer<typeof question>;

export const formPatch = z.object({
  title: z.string().trim().min(1, 'Gib dem Formular einen Titel').max(200).optional(),
  description: z.string().max(4000).optional(),
  questions: z.array(question).max(FORM_LIMITS.questions, 'Mehr als 100 Fragen gehen nicht').optional(),
  accepting: z.boolean().optional(),
  closesAt: z.number().int().positive().max(8_640_000_000_000).nullable().optional(),
  maxResponses: z.number().int().min(1).max(FORM_LIMITS.responses).nullable().optional(),
  once: z.boolean().optional(),
  signedIn: z.boolean().optional(),
  named: z.boolean().optional(),
  notify: z.boolean().optional(),
  confirmation: z.string().max(2000).optional(),
});

export type FormPatch = z.infer<typeof formPatch>;

export interface FormRow {
  id: string;
  owner_id: number;
  title: string;
  description: string;
  questions: string;
  token: string;
  accepting: number;
  closes_at: number | null;
  max_responses: number | null;
  once: number;
  signed_in: number;
  named: number;
  notify: number;
  confirmation: string;
  created_at: number;
  updated_at: number;
}

interface ResponseRow {
  id: string;
  form_id: string;
  user_id: number | null;
  respondent: string | null;
  answers: string;
  created_at: number;
}

export type Answer = string | string[] | number;
export type Answers = Record<string, Answer>;

export class FormInputError extends HttpError {
  errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(400, 'Bitte prüf die markierten Fragen', 'form_invalid');
    this.errors = errors;
  }
}

export const formsEnabled = () => settings.get('forms.enabled');

function normalize(list: Question[]) {
  const seen = new Set<string>();
  return list.map((entry) => {
    if (seen.has(entry.id)) throw badRequest('Zwei Fragen haben dieselbe Kennung');
    seen.add(entry.id);
    const labels = new Set<string>();
    const options = entry.kind === 'single' || entry.kind === 'multiple' ? entry.options.filter((choice) => choice.label) : [];
    for (const choice of options) {
      if (labels.has(choice.id)) throw badRequest('Zwei Antworten einer Frage haben dieselbe Kennung');
      labels.add(choice.id);
    }
    let min = entry.min;
    let max = entry.max;
    if (entry.kind === 'scale') {
      min = min === 0 ? 0 : 1;
      max = Math.min(10, Math.max(2, max ?? 5));
    } else if (entry.kind === 'number') {
      if (min !== null && max !== null && min > max)
        throw badRequest('Bei „{title}“ ist das Minimum größer als das Maximum', { title: entry.title });
    } else {
      min = null;
      max = null;
    }
    return {
      ...entry,
      options,
      min,
      max,
      low: entry.kind === 'scale' ? entry.low : '',
      high: entry.kind === 'scale' ? entry.high : '',
    };
  });
}

export const questionsOf = (form: Pick<FormRow, 'questions'>) => JSON.parse(form.questions) as Question[];

export const responseCount = (formId: string) =>
  Number(value<number>('SELECT COUNT(*) FROM form_responses WHERE form_id = ?', formId) ?? 0);

export function formState(form: FormRow, count = responseCount(form.id), now = Date.now()): FormState {
  if (!form.accepting) return 'closed';
  if (form.closes_at !== null && Number(form.closes_at) <= now) return 'ended';
  if (form.max_responses !== null && count >= Number(form.max_responses)) return 'full';
  return 'open';
}

export function presentForm(form: FormRow) {
  const responses = responseCount(form.id);
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    questions: questionsOf(form),
    accepting: Boolean(form.accepting),
    closesAt: form.closes_at === null ? null : Number(form.closes_at),
    maxResponses: form.max_responses === null ? null : Number(form.max_responses),
    once: Boolean(form.once),
    signedIn: Boolean(form.signed_in),
    named: Boolean(form.named),
    notify: Boolean(form.notify),
    confirmation: form.confirmation,
    url: `/f/${form.token}`,
    responses,
    state: formState(form, responses),
    createdAt: Number(form.created_at),
    updatedAt: Number(form.updated_at),
  };
}

function requireCreator(user: UserRow) {
  if (!formsEnabled()) throw forbidden('Formulare sind in dieser Cloud ausgeschaltet');
  if (user.role === 'guest') throw forbidden('Gäste können keine Formulare anlegen');
}

export function ownForm(user: UserRow, id: string) {
  requireCreator(user);
  const form = one<FormRow>('SELECT * FROM forms WHERE id = ?', String(id).slice(0, 64));
  if (!form || form.owner_id !== user.id) throw notFound('Das Formular gibt es nicht');
  return form;
}

export const listForms = (user: UserRow) => {
  requireCreator(user);
  return all<FormRow>('SELECT * FROM forms WHERE owner_id = ? ORDER BY updated_at DESC, id', user.id).map(presentForm);
};

const changed = (form: Pick<FormRow, 'owner_id' | 'id'>) => publish([form.owner_id], 'forms', { id: form.id });

const STARTER = (lang: Lang): Question[] => [
  {
    id: randomId(10),
    kind: 'text',
    title: t(lang, 'Wie heißt du?'),
    description: '',
    required: true,
    options: [],
    min: null,
    max: null,
    low: '',
    high: '',
  },
];

export function createForm(user: UserRow, title: string, lang: Lang) {
  requireCreator(user);
  if (Number(value<number>('SELECT COUNT(*) FROM forms WHERE owner_id = ?', user.id) ?? 0) >= 500)
    throw badRequest('Mehr als 500 Formulare gehen nicht');
  const now = Date.now();
  const id = randomId(16);
  run(
    'INSERT INTO forms (id, owner_id, title, questions, token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    user.id,
    title,
    JSON.stringify(STARTER(lang)),
    randomId(22),
    now,
    now
  );
  const form = one<FormRow>('SELECT * FROM forms WHERE id = ?', id)!;
  changed(form);
  return form;
}

export function updateForm(user: UserRow, id: string, input: FormPatch) {
  const form = ownForm(user, id);
  const named = input.named ?? Boolean(form.named);
  const signedIn = input.signedIn ?? Boolean(form.signed_in);
  if (named && !signedIn) throw badRequest('Namen gibt es nur bei Formularen, die nur Angemeldete ausfüllen');
  const questions = input.questions ? JSON.stringify(normalize(input.questions)) : form.questions;
  run(
    `UPDATE forms SET title = ?, description = ?, questions = ?, accepting = ?, closes_at = ?, max_responses = ?, once = ?, signed_in = ?,
       named = ?, notify = ?, confirmation = ?, updated_at = ? WHERE id = ?`,
    input.title ?? form.title,
    input.description ?? form.description,
    questions,
    input.accepting === undefined ? form.accepting : input.accepting ? 1 : 0,
    input.closesAt === undefined ? form.closes_at : input.closesAt,
    input.maxResponses === undefined ? form.max_responses : input.maxResponses,
    input.once === undefined ? form.once : input.once ? 1 : 0,
    signedIn ? 1 : 0,
    named ? 1 : 0,
    input.notify === undefined ? form.notify : input.notify ? 1 : 0,
    input.confirmation ?? form.confirmation,
    Date.now(),
    form.id
  );
  const fresh = one<FormRow>('SELECT * FROM forms WHERE id = ?', form.id)!;
  changed(fresh);
  return fresh;
}

export function copyForm(user: UserRow, id: string, lang: Lang) {
  const form = ownForm(user, id);
  const copy = createForm(user, t(lang, 'Kopie von {title}', { title: form.title }).slice(0, 200), lang);
  run(
    `UPDATE forms SET description = ?, questions = ?, once = ?, signed_in = ?, named = ?, notify = ?, confirmation = ?, max_responses = ? WHERE id = ?`,
    form.description,
    form.questions,
    form.once,
    form.signed_in,
    form.named,
    form.notify,
    form.confirmation,
    form.max_responses,
    copy.id
  );
  return one<FormRow>('SELECT * FROM forms WHERE id = ?', copy.id)!;
}

export function renewToken(user: UserRow, id: string) {
  const form = ownForm(user, id);
  run('UPDATE forms SET token = ?, updated_at = ? WHERE id = ?', randomId(22), Date.now(), form.id);
  const fresh = one<FormRow>('SELECT * FROM forms WHERE id = ?', form.id)!;
  changed(fresh);
  return fresh;
}

export function deleteForm(user: UserRow, id: string) {
  const form = ownForm(user, id);
  run('DELETE FROM forms WHERE id = ?', form.id);
  changed(form);
}

export function formByToken(token: string) {
  if (!formsEnabled() || !/^[A-Za-z0-9_-]{10,64}$/.test(token)) return null;
  const form = one<FormRow>('SELECT * FROM forms WHERE token = ?', token);
  if (!form) return null;
  const owner = getUser(form.owner_id);
  if (!owner || inactive(owner)) return null;
  return form;
}

export const respondentOf = (form: Pick<FormRow, 'id'>, user: Pick<UserRow, 'id'>) => sha256(`form:${form.id}:${user.id}`);

export const hasAnswered = (form: Pick<FormRow, 'id'>, user: Pick<UserRow, 'id'>) =>
  Boolean(one('SELECT 1 AS found FROM form_responses WHERE form_id = ? AND respondent = ?', form.id, respondentOf(form, user)));

export const visibleQuestions = (form: Pick<FormRow, 'questions'>) =>
  questionsOf(form).filter((entry) => (entry.kind !== 'single' && entry.kind !== 'multiple') || entry.options.length > 0);

function validDate(text: string) {
  const match = DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseAnswers(form: Pick<FormRow, 'questions'>, fields: Record<string, unknown>, lang: Lang) {
  const answers: Answers = {};
  const errors: Record<string, string> = {};
  const field = (name: string) => {
    const raw = fields[name];
    return typeof raw === 'string' ? raw : '';
  };
  for (const entry of visibleQuestions(form)) {
    const name = `q-${entry.id}`;
    const fail = (message: string, params?: Record<string, string | number>) => {
      errors[entry.id] = t(lang, message, params);
    };
    if (entry.kind === 'multiple') {
      const picked = entry.options.filter((choice) => field(`${name}-${choice.id}`) !== '').map((choice) => choice.id);
      if (picked.length) answers[entry.id] = picked;
      else if (entry.required) fail('Wähl mindestens eine Antwort');
      continue;
    }
    const text = field(name).replace(/\r\n?/g, '\n');
    const trimmed = text.trim();
    if (!trimmed) {
      if (entry.required)
        fail(entry.kind === 'single' || entry.kind === 'scale' ? 'Wähl eine Antwort' : 'Diese Frage braucht eine Antwort');
      continue;
    }
    switch (entry.kind) {
      case 'text':
        if (trimmed.length > FORM_LIMITS.text) fail('Höchstens {count} Zeichen', { count: FORM_LIMITS.text });
        else answers[entry.id] = trimmed;
        break;
      case 'longtext':
        if (trimmed.length > FORM_LIMITS.longtext) fail('Höchstens {count} Zeichen', { count: FORM_LIMITS.longtext });
        else answers[entry.id] = trimmed;
        break;
      case 'email':
        if (trimmed.length > 320 || !EMAIL.test(trimmed)) fail('Das ist keine E-Mail-Adresse');
        else answers[entry.id] = trimmed;
        break;
      case 'date':
        if (!validDate(trimmed)) fail('Das ist kein Datum');
        else answers[entry.id] = trimmed;
        break;
      case 'number': {
        const number = NUMBER.test(trimmed) ? Number(trimmed.replace(',', '.')) : Number.NaN;
        if (!Number.isFinite(number)) fail('Das ist keine Zahl');
        else if (entry.min !== null && number < entry.min) fail('Mindestens {count}', { count: entry.min });
        else if (entry.max !== null && number > entry.max) fail('Höchstens {count}', { count: entry.max });
        else answers[entry.id] = number;
        break;
      }
      case 'scale': {
        const number = /^\d{1,2}$/.test(trimmed) ? Number(trimmed) : Number.NaN;
        if (!Number.isInteger(number) || number < (entry.min ?? 1) || number > (entry.max ?? 5)) fail('Wähl eine Antwort');
        else answers[entry.id] = number;
        break;
      }
      case 'single':
        if (!entry.options.some((choice) => choice.id === trimmed)) fail('Wähl eine Antwort');
        else answers[entry.id] = trimmed;
        break;
    }
  }
  return { answers, errors };
}

export function submitResponse(form: FormRow, user: UserRow | null, fields: Record<string, unknown>, lang: Lang) {
  if (form.signed_in && !user) throw new HttpError(401, 'Melde dich an, um zu antworten', 'unauthorized');
  if (form.signed_in && user && form.once && hasAnswered(form, user)) throw new HttpError(409, 'Du hast schon geantwortet', 'answered');
  const { answers, errors } = parseAnswers(form, fields, lang);
  if (Object.keys(errors).length) throw new FormInputError(errors);
  const id = randomId(16);
  tx(() => {
    const state = formState(form);
    if (state !== 'open') throw new HttpError(410, 'Dieses Formular nimmt keine Antworten mehr an', `form_${state}`);
    run(
      'INSERT INTO form_responses (id, form_id, user_id, respondent, answers, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      form.id,
      user && form.named ? user.id : null,
      user && form.signed_in ? respondentOf(form, user) : null,
      JSON.stringify(answers),
      Date.now()
    );
  });
  if (form.notify) notifyMerged(form.owner_id, 'form_response', { title: form.title }, `/files/forms/${form.id}#antworten`);
  changed(form);
  return id;
}

function labelOf(entry: Question, answer: Answer | undefined) {
  if (answer === undefined) return '';
  if (entry.kind === 'single') return entry.options.find((choice) => choice.id === answer)?.label ?? '';
  if (entry.kind === 'multiple' && Array.isArray(answer))
    return answer
      .map((id) => entry.options.find((choice) => choice.id === id)?.label)
      .filter(Boolean)
      .join('; ');
  return String(answer);
}

function presentResponse(form: FormRow, row: ResponseRow, questions: Question[]) {
  const answers = JSON.parse(row.answers) as Answers;
  const person = form.named && row.user_id ? getUser(row.user_id) : null;
  return {
    id: row.id,
    createdAt: Number(row.created_at),
    person: person ? { id: person.id, name: person.name, username: person.username } : null,
    answers: questions.map((entry) => ({ question: entry.id, value: answers[entry.id] ?? null, text: labelOf(entry, answers[entry.id]) })),
  };
}

export function listResponses(user: UserRow, id: string, offset: number, limit: number) {
  const form = ownForm(user, id);
  const questions = questionsOf(form);
  const rows = all<ResponseRow>(
    'SELECT * FROM form_responses WHERE form_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    form.id,
    limit,
    offset
  );
  return { total: responseCount(form.id), items: rows.map((row) => presentResponse(form, row, questions)) };
}

export function deleteResponses(user: UserRow, id: string, responseId: string | null) {
  const form = ownForm(user, id);
  const removed = responseId
    ? run('DELETE FROM form_responses WHERE form_id = ? AND id = ?', form.id, responseId.slice(0, 64)).changes
    : run('DELETE FROM form_responses WHERE form_id = ?', form.id).changes;
  if (responseId && !removed) throw notFound('Die Antwort gibt es nicht');
  changed(form);
  return removed;
}

export function formResults(user: UserRow, id: string) {
  const form = ownForm(user, id);
  const questions = questionsOf(form);
  const rows = all<{ answers: string }>(
    'SELECT answers FROM form_responses WHERE form_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    form.id,
    FORM_LIMITS.responses
  ).map((row) => JSON.parse(row.answers) as Answers);
  return {
    total: responseCount(form.id),
    questions: questions.map((entry) => {
      const given = rows.map((answers) => answers[entry.id]).filter((answer) => answer !== undefined);
      const base = { id: entry.id, kind: entry.kind, title: entry.title, answered: given.length };
      if (entry.kind === 'single' || entry.kind === 'multiple') {
        const counts = new Map(entry.options.map((choice) => [choice.id, 0]));
        for (const answer of given) {
          for (const choice of Array.isArray(answer) ? answer : [String(answer)]) {
            if (counts.has(choice)) counts.set(choice, counts.get(choice)! + 1);
          }
        }
        return { ...base, options: entry.options.map((choice) => ({ id: choice.id, label: choice.label, count: counts.get(choice.id)! })) };
      }
      if (entry.kind === 'scale') {
        const min = entry.min ?? 1;
        const max = entry.max ?? 5;
        const numbers = given.map(Number).filter((number) => Number.isInteger(number) && number >= min && number <= max);
        return {
          ...base,
          average: numbers.length ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length : null,
          low: entry.low,
          high: entry.high,
          options: Array.from({ length: max - min + 1 }, (_, index) => ({
            id: String(min + index),
            label: String(min + index),
            count: numbers.filter((number) => number === min + index).length,
          })),
        };
      }
      if (entry.kind === 'number') {
        const numbers = given.map(Number).filter(Number.isFinite);
        return {
          ...base,
          average: numbers.length ? numbers.reduce((sum, number) => sum + number, 0) / numbers.length : null,
          min: numbers.length ? Math.min(...numbers) : null,
          max: numbers.length ? Math.max(...numbers) : null,
        };
      }
      return { ...base, latest: given.slice(0, 20).map(String) };
    }),
  };
}

export function formCsv(user: UserRow, id: string, lang: Lang) {
  const form = ownForm(user, id);
  const questions = questionsOf(form);
  const lines = [
    csvRow([
      t(lang, 'Zeitpunkt'),
      ...(form.named ? [t(lang, 'Name'), t(lang, 'Benutzername')] : []),
      ...questions.map((entry) => entry.title || t(lang, 'Frage ohne Titel')),
    ]),
  ];
  const rows = all<ResponseRow>(
    'SELECT * FROM form_responses WHERE form_id = ? ORDER BY created_at, id LIMIT ?',
    form.id,
    FORM_LIMITS.responses
  );
  for (const row of rows) {
    const response = presentResponse(form, row, questions);
    lines.push(
      csvRow([
        new Date(response.createdAt).toISOString(),
        ...(form.named ? [response.person?.name ?? '', response.person?.username ?? ''] : []),
        ...response.answers.map((answer) => answer.text),
      ])
    );
  }
  return { form, text: csvDocument(lines), rows: rows.length };
}

export function formsOfUser(userId: number) {
  return all<FormRow>('SELECT * FROM forms WHERE owner_id = ? ORDER BY created_at', userId).map((form) => ({
    ...presentForm(form),
    answers: all<ResponseRow>('SELECT * FROM form_responses WHERE form_id = ? ORDER BY created_at, id', form.id).map((row) => ({
      createdAt: Number(row.created_at),
      answers: JSON.parse(row.answers) as Answers,
    })),
  }));
}
