import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { randomId } from '../lib/crypto.ts';
import { csvDocument } from '../lib/csv.ts';
import { one, run, tx } from '../lib/db.ts';
import { badRequest, forbidden, notFound, tooLarge } from '../lib/errors.ts';
import { blobPath } from '../services/blobs.ts';
import { requireAccess } from '../services/nodes.ts';
import { parseCsv } from '../services/userimport.ts';
import type { UserRow } from '../services/users.ts';
import { decodeText, parseDateText, zipEntries } from '../calendar/sources.ts';
import { announceContacts, bookMembers, insertBook, presentBook, requireBook } from './books.ts';
import { cardOf, dataOf, liveByUid, prepareCard, storeCard, type ContactRow } from './store.ts';
import {
  applyContact,
  emptyContact,
  parseVCards,
  readContact,
  setUid,
  uidOf,
  VCardError,
  type Address,
  type ContactData,
  type Entry,
  type EntryType,
  type VCard,
} from './vcard.ts';

export const CONTACT_LIMITS = { files: 50, bytes: 60 * 1024 * 1024, file: 30 * 1024 * 1024, cards: 20_000 };

const VCARD_FILE = /\.(vcf|vcard)$/i;
const CSV_FILE = /\.(csv|tsv|txt)$/i;

export class ContactImportError extends Error {
  params: Record<string, string | number>;
  constructor(message: string, params: Record<string, string | number> = {}) {
    super(message);
    this.params = params;
  }
}

const COLUMNS: Record<string, string[]> = {
  name: ['name', 'display name', 'full name', 'anzeigename', 'vollständiger name'],
  given: ['first name', 'given name', 'vorname'],
  additional: ['middle name', 'additional name', 'weitere vornamen', 'zweiter vorname'],
  family: ['last name', 'family name', 'surname', 'nachname'],
  prefix: ['name prefix', 'title', 'anrede', 'titel'],
  suffix: ['name suffix', 'suffix', 'namenszusatz'],
  nickname: ['nickname', 'spitzname'],
  organization: ['organization name', 'organization 1 - name', 'company', 'firma', 'organisation', 'unternehmen'],
  title: ['organization title', 'organization 1 - title', 'job title', 'position', 'berufsbezeichnung'],
  department: ['organization department', 'organization 1 - department', 'department', 'abteilung'],
  birthday: ['birthday', 'geburtstag'],
  anniversary: ['anniversary', 'jahrestag'],
  note: ['notes', 'note', 'notizen', 'notiz'],
  labels: ['labels', 'group membership', 'categories', 'kategorien'],
};

const FIXED_EMAILS: [string, EntryType][] = [
  ['e-mail address', 'other'],
  ['e-mail 2 address', 'other'],
  ['e-mail 3 address', 'other'],
  ['e-mail-adresse', 'other'],
  ['e-mail 2: adresse', 'other'],
  ['e-mail 3: adresse', 'other'],
  ['email', 'other'],
  ['e-mail', 'other'],
];

const FIXED_PHONES: [string, EntryType][] = [
  ['mobile phone', 'mobile'],
  ['home phone', 'home'],
  ['home phone 2', 'home'],
  ['business phone', 'work'],
  ['business phone 2', 'work'],
  ['company main phone', 'main'],
  ['primary phone', 'main'],
  ['other phone', 'other'],
  ['car phone', 'other'],
  ['pager', 'pager'],
  ['business fax', 'fax'],
  ['home fax', 'fax'],
  ['other fax', 'fax'],
  ['mobiltelefon', 'mobile'],
  ['telefon privat', 'home'],
  ['telefon privat 2', 'home'],
  ['telefon geschäftlich', 'work'],
  ['telefon geschäftlich 2', 'work'],
  ['telefon firma', 'main'],
  ['haupttelefon', 'main'],
  ['weiteres telefon', 'other'],
  ['autotelefon', 'other'],
  ['fax geschäftlich', 'fax'],
  ['fax privat', 'fax'],
  ['weiteres fax', 'fax'],
  ['telefon', 'other'],
  ['phone', 'other'],
];

const FIXED_ADDRESSES: { type: EntryType; street: string[]; locality: string[]; region: string[]; code: string[]; country: string[] }[] = [
  {
    type: 'work',
    street: ['business street', 'straße geschäftlich'],
    locality: ['business city', 'ort geschäftlich'],
    region: ['business state', 'region geschäftlich', 'bundesland geschäftlich'],
    code: ['business postal code', 'postleitzahl geschäftlich'],
    country: ['business country/region', 'business country', 'land/region geschäftlich', 'land geschäftlich'],
  },
  {
    type: 'home',
    street: ['home street', 'straße privat'],
    locality: ['home city', 'ort privat'],
    region: ['home state', 'region privat', 'bundesland privat'],
    code: ['home postal code', 'postleitzahl privat'],
    country: ['home country/region', 'home country', 'land/region privat', 'land privat'],
  },
  {
    type: 'other',
    street: ['other street', 'weitere straße'],
    locality: ['other city', 'weiterer ort'],
    region: ['other state', 'weitere region', 'weiteres bundesland'],
    code: ['other postal code', 'weitere postleitzahl'],
    country: ['other country/region', 'other country', 'weiteres land/region', 'weiteres land'],
  },
];

const FIXED_URLS: [string, EntryType][] = [
  ['web page', 'work'],
  ['personal web page', 'home'],
  ['webseite', 'work'],
  ['persönliche webseite', 'home'],
  ['website', 'other'],
];

const LABEL_TYPES: [RegExp, EntryType][] = [
  [/^(mobile|mobil|handy|cell|cellular)$/i, 'mobile'],
  [/^(home|privat|zuhause|zu hause|personal)$/i, 'home'],
  [/^(work|arbeit|geschäftlich|büro|business|office)$/i, 'work'],
  [/^(main|haupt|hauptnummer|zentrale)$/i, 'main'],
  [/fax/i, 'fax'],
  [/^(pager|piepser)$/i, 'pager'],
  [/^(other|sonstige|sonstiges|andere|weitere|)$/i, 'other'],
];

function labelType(raw: string): { type: EntryType; label: string | null } {
  const value = raw.replace(/^\*\s*/, '').trim();
  for (const [pattern, type] of LABEL_TYPES) if (pattern.test(value)) return { type, label: null };
  return { type: 'other', label: value.slice(0, 60) };
}

const multi = (value: string) =>
  value
    .split(/\s*:::\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);

function birthdayOf(raw: string, order: 'dmy' | 'mdy') {
  const value = raw.trim();
  if (!value || /^0{1,2}[./]0{1,2}[./]0{2,4}$/.test(value)) return null;
  const noYear = /^--(\d{2})-?(\d{2})$/.exec(value);
  if (noYear) return `--${noYear[1]}-${noYear[2]}`;
  const parsed = parseDateText(value, order);
  if (!parsed) return null;
  return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')}`;
}

export function cardsFromCsv(text: string, origin: string): VCard[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => cell.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' '));
  const column = (names: string[]) => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const fields = Object.fromEntries(Object.entries(COLUMNS).map(([key, names]) => [key, column(names)])) as Record<
    keyof typeof COLUMNS,
    number
  >;
  const numbered = (kind: string) => {
    const out: { label: number; value: number; extra: Record<string, number> }[] = [];
    for (let index = 1; index <= 20; index++) {
      const value = header.indexOf(`${kind} ${index} - value`);
      const formatted = header.indexOf(`${kind} ${index} - formatted`);
      const street = header.indexOf(`${kind} ${index} - street`);
      if (value < 0 && formatted < 0 && street < 0) continue;
      const label = Math.max(header.indexOf(`${kind} ${index} - label`), header.indexOf(`${kind} ${index} - type`));
      const extra: Record<string, number> = {};
      for (const part of ['formatted', 'street', 'city', 'po box', 'region', 'postal code', 'country', 'extended address'])
        extra[part] = header.indexOf(`${kind} ${index} - ${part}`);
      out.push({ label, value, extra });
    }
    return out;
  };
  const emailColumns = numbered('e-mail');
  const phoneColumns = numbered('phone');
  const addressColumns = numbered('address');
  const urlColumns = numbered('website');
  const fixedEmails = FIXED_EMAILS.map(([name, type]) => [header.indexOf(name), type] as const).filter(([index]) => index >= 0);
  const fixedPhones = FIXED_PHONES.map(([name, type]) => [header.indexOf(name), type] as const).filter(([index]) => index >= 0);
  const fixedUrls = FIXED_URLS.map(([name, type]) => [header.indexOf(name), type] as const).filter(([index]) => index >= 0);
  const fixedAddresses = FIXED_ADDRESSES.map((spec) => ({
    type: spec.type,
    street: column(spec.street),
    locality: column(spec.locality),
    region: column(spec.region),
    code: column(spec.code),
    country: column(spec.country),
  })).filter((spec) => spec.street >= 0 || spec.locality >= 0 || spec.code >= 0);
  const known =
    fields.given >= 0 ||
    fields.family >= 0 ||
    fields.name >= 0 ||
    fields.organization >= 0 ||
    emailColumns.length > 0 ||
    fixedEmails.length > 0 ||
    phoneColumns.length > 0 ||
    fixedPhones.length > 0;
  if (!known) throw new ContactImportError('In „{name}“ fehlen Spalten für Namen, E-Mail-Adressen oder Telefonnummern', { name: origin });
  let order: 'dmy' | 'mdy' | null = null;
  for (const row of rows.slice(1, 2000)) {
    for (const index of [fields.birthday, fields.anniversary]) {
      const match = /^(\d{1,2})\/(\d{1,2})\//.exec(index >= 0 ? (row[index] ?? '').trim() : '');
      if (!match) continue;
      if (Number(match[1]) > 12) order ??= 'dmy';
      else if (Number(match[2]) > 12) order ??= 'mdy';
    }
  }
  order ??= header.includes('vorname') || header.includes('nachname') ? 'dmy' : 'mdy';
  const cards: VCard[] = [];
  for (const row of rows.slice(1, CONTACT_LIMITS.cards + 1)) {
    const cell = (index: number) => (index >= 0 ? (row[index] ?? '').trim().replace(/^'(?=[=+\-@])/, '') : '');
    const data = emptyContact();
    data.given = cell(fields.given);
    data.additional = cell(fields.additional);
    data.family = cell(fields.family);
    data.prefix = cell(fields.prefix);
    data.suffix = cell(fields.suffix);
    data.nickname = cell(fields.nickname);
    data.organization = cell(fields.organization);
    data.title = cell(fields.title);
    data.department = cell(fields.department);
    data.note = cell(fields.note);
    data.birthday = birthdayOf(cell(fields.birthday), order);
    data.anniversary = birthdayOf(cell(fields.anniversary), order);
    const emails: Entry[] = [];
    for (const spec of emailColumns) {
      const kind = labelType(cell(spec.label));
      for (const value of multi(cell(spec.value))) emails.push({ ...kind, value });
    }
    for (const [index, type] of fixedEmails) for (const value of multi(cell(index))) emails.push({ type, value, label: null });
    const phones: Entry[] = [];
    for (const spec of phoneColumns) {
      const kind = labelType(cell(spec.label));
      for (const value of multi(cell(spec.value))) phones.push({ ...kind, value });
    }
    for (const [index, type] of fixedPhones) for (const value of multi(cell(index))) phones.push({ type, value, label: null });
    const addresses: Address[] = [];
    for (const spec of addressColumns) {
      const kind = labelType(cell(spec.label));
      const part = (name: string) => cell(spec.extra[name] ?? -1);
      const address: Address = {
        ...kind,
        street: part('street') || (!part('city') && !part('postal code') ? part('formatted') : ''),
        locality: part('city'),
        region: part('region'),
        code: part('postal code'),
        country: part('country'),
        pobox: part('po box'),
        extended: part('extended address'),
      };
      if ([address.street, address.locality, address.region, address.code, address.country, address.pobox].some(Boolean))
        addresses.push(address);
    }
    for (const spec of fixedAddresses) {
      const address: Address = {
        type: spec.type,
        label: null,
        street: cell(spec.street),
        locality: cell(spec.locality),
        region: cell(spec.region),
        code: cell(spec.code),
        country: cell(spec.country),
        pobox: '',
        extended: '',
      };
      if ([address.street, address.locality, address.region, address.code, address.country].some(Boolean)) addresses.push(address);
    }
    const urls: Entry[] = [];
    for (const spec of urlColumns) {
      const kind = labelType(cell(spec.label));
      for (const value of multi(cell(spec.value))) urls.push({ ...kind, value });
    }
    for (const [index, type] of fixedUrls) for (const value of multi(cell(index))) urls.push({ type, value, label: null });
    data.emails = emails;
    data.phones = phones;
    data.addresses = addresses;
    data.urls = urls;
    const labels = multi(cell(fields.labels).replace(/;/g, ' ::: '));
    data.categories = labels.filter((label) => !/^\*\s*(mycontacts|starred)$/i.test(label)).map((label) => label.replace(/^\*\s*/, ''));
    data.name = cell(fields.name);
    const starred = labels.some((label) => /^\*\s*starred$/i.test(label));
    if (!data.name && !data.given && !data.family && !data.organization && !emails.length && !phones.length) continue;
    if (data.organization && !data.given && !data.family && !data.name) data.kind = 'org';
    const uid = `csv-${createHash('sha1')
      .update(
        [
          data.name,
          data.given,
          data.family,
          data.organization,
          ...emails.map((entry) => entry.value),
          ...phones.map((entry) => entry.value),
        ]
          .join('|')
          .toLowerCase()
      )
      .digest('hex')
      .slice(0, 24)}@moecloud`;
    const card = applyContact(null, data, uid);
    if (starred) card.props.push({ group: null, name: 'X-MOE-STARRED', params: {}, value: '1' });
    cards.push(card);
  }
  return cards;
}

export interface ContactFile {
  name: string;
  data: Buffer;
}

export async function cardsFromFiles(files: ContactFile[]) {
  const cards: VCard[] = [];
  const warnings: { message: string; params: Record<string, string | number> }[] = [];
  const read = async (name: string, data: Buffer, nested: boolean) => {
    if (/\.zip$/i.test(name) && !nested) {
      const entries = await zipEntries(data, name, (entry) => VCARD_FILE.test(entry) || /\.csv$/i.test(entry)).catch(() => {
        throw new ContactImportError('„{name}“ ist kein lesbares ZIP-Archiv', { name });
      });
      if (!entries.length) warnings.push({ message: 'In „{name}“ sind keine Kontakte', params: { name } });
      for (const entry of entries) await read(entry.name, entry.data, true);
      return;
    }
    const text = decodeText(data);
    let found: VCard[];
    try {
      if (/BEGIN:VCARD/i.test(text.slice(0, 4096)) || VCARD_FILE.test(name)) found = parseVCards(text, CONTACT_LIMITS.cards);
      else if (CSV_FILE.test(name) || text.slice(0, 2048).includes(',') || text.slice(0, 2048).includes(';'))
        found = cardsFromCsv(text, name);
      else throw new ContactImportError('„{name}“ ist keine Kontaktdatei', { name });
    } catch (error) {
      if (error instanceof VCardError) throw new ContactImportError('„{name}“ enthält zu viele Kontakte', { name });
      throw error;
    }
    if (!found.length) warnings.push({ message: 'In „{name}“ sind keine Kontakte', params: { name } });
    cards.push(...found);
    if (cards.length > CONTACT_LIMITS.cards) throw new ContactImportError('Das sind zu viele Kontakte auf einmal');
  };
  for (const file of files) await read(file.name, file.data, false);
  return { cards: cards.map(prepareCard), warnings };
}

interface ImportJob {
  id: string;
  userId: number;
  cards: VCard[];
  names: string[];
  warnings: { message: string; params: Record<string, string | number> }[];
  created: number;
}

const jobs = new Map<string, ImportJob>();
const KEEP = 30 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, job] of jobs) if (now - job.created > KEEP) jobs.delete(id);
}

export function presentContactImport(job: ImportJob) {
  const groups = job.cards.filter((card) => readContact(card).kind === 'group').length;
  return {
    id: job.id,
    count: job.cards.length - groups,
    groups,
    files: job.names,
    sample: job.cards
      .map((card) => readContact(card))
      .filter((data) => data.kind !== 'group')
      .slice(0, 6)
      .map((data) => ({ name: data.name, email: data.emails[0]?.value ?? null, phone: data.phones[0]?.value ?? null })),
    warnings: job.warnings,
  };
}

export async function startContactImport(user: UserRow, files: ContactFile[]) {
  sweep();
  if (!files.length) throw badRequest('Wähle mindestens eine Datei aus');
  const total = files.reduce((sum, file) => sum + file.data.length, 0);
  if (total > CONTACT_LIMITS.bytes) throw tooLarge('Die Dateien sind zu groß zum Importieren');
  const { cards, warnings } = await cardsFromFiles(files);
  if (!cards.length) throw badRequest('In den Dateien sind keine Kontakte');
  const mine = [...jobs.values()].filter((job) => job.userId === user.id).sort((a, b) => a.created - b.created);
  while (mine.length >= 3) jobs.delete(mine.shift()!.id);
  const job: ImportJob = { id: randomId(16), userId: user.id, cards, names: files.map((file) => file.name), warnings, created: Date.now() };
  jobs.set(job.id, job);
  return presentContactImport(job);
}

export async function startContactNodeImport(user: UserRow, nodeId: string) {
  const { node } = requireAccess(user, nodeId, 'view');
  if (node.type !== 'file' || !node.sha256) throw badRequest('Das ist keine Datei');
  if ((node.size ?? 0) > CONTACT_LIMITS.file) throw tooLarge('Die Datei ist zu groß zum Importieren');
  const blob = one<{ scan_status: string | null }>('SELECT scan_status FROM blobs WHERE sha256 = ?', node.sha256);
  if (blob?.scan_status === 'infected') throw forbidden('Die Datei enthält Schadsoftware');
  const data = await readFile(blobPath(node.sha256)).catch(() => {
    throw notFound('Diese Datei gibt es nicht mehr');
  });
  return startContactImport(user, [{ name: node.name, data }]);
}

export function getContactImport(user: UserRow, id: string) {
  sweep();
  const job = jobs.get(id);
  if (!job || job.userId !== user.id) throw notFound('Diesen Import gibt es nicht mehr, lade die Dateien bitte noch mal hoch');
  return job;
}

export function discardContactImport(user: UserRow, id: string) {
  const job = jobs.get(id);
  if (job && job.userId === user.id) jobs.delete(id);
}

export type ContactImportMode = 'merge' | 'skip' | 'copy';

export function importCards(user: UserRow, bookId: string, cards: VCard[], mode: ContactImportMode) {
  const { book } = requireBook(user, bookId, 'write');
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const stars: string[] = [];
  tx(() => {
    for (const source of cards) {
      const card = { props: source.props.filter((prop) => prop.name !== 'X-MOE-STARRED') };
      const starred = card.props.length !== source.props.length;
      let uid = uidOf(card) ?? randomUUID();
      let previous: ContactRow | null = liveByUid(book.id, uid) ?? null;
      if (previous && mode === 'skip') {
        skipped++;
        continue;
      }
      if (previous && mode === 'copy') {
        uid = randomUUID();
        previous = null;
      }
      setUid(card, uid);
      if (previous) {
        const before = dataOf(previous);
        const next = readContact(card);
        if (JSON.stringify(before) === JSON.stringify(next)) {
          skipped++;
          continue;
        }
        if (!next.photo && before.photo) {
          const photo = cardOf(previous).props.find((prop) => prop.name === 'PHOTO');
          if (photo) card.props.push(photo);
        }
      }
      const row = storeCard(book, card, { actor: user.id, previous });
      if (starred) stars.push(row.id);
      if (previous) updated++;
      else created++;
    }
    for (const id of stars)
      run('INSERT INTO contact_stars (user_id, contact_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', user.id, id, Date.now());
  });
  announceContacts(bookMembers(book.id));
  return { created, updated, skipped, book: presentBook(book, requireBook(user, book.id).access) };
}

export function runContactImport(user: UserRow, id: string, target: { book: string; name?: string }, mode: ContactImportMode) {
  const job = getContactImport(user, id);
  let bookId = target.book;
  if (bookId === 'new') {
    const name = target.name?.trim() || job.names[0]?.replace(/\.[^.]+$/, '') || 'Importiert';
    bookId = insertBook(user, { name }).id;
  }
  const result = importCards(user, bookId, job.cards, mode);
  jobs.delete(job.id);
  return result;
}

export function contactImportsSettled() {
  jobs.clear();
}

const HARMLESS = /^[+-]?[\d\s()./-]+$/;

function cellOf(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (text && /^[=+\-@\t\r]/.test(text) && !HARMLESS.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const csvLine = (values: unknown[]) => values.map(cellOf).join(',');

const TYPE_LABEL: Record<EntryType, string> = {
  home: 'Home',
  work: 'Work',
  mobile: 'Mobile',
  main: 'Main',
  fax: 'Work Fax',
  pager: 'Pager',
  other: 'Other',
};

export function exportContactsCsv(rows: ContactRow[], starred: Set<string>) {
  const list = rows.filter((row) => row.kind !== 'group').map((row) => ({ row, data: dataOf(row) }));
  const most = (pick: (data: ContactData) => unknown[]) => Math.max(1, ...list.map((entry) => pick(entry.data).length));
  const emailCount = most((data) => data.emails);
  const phoneCount = most((data) => data.phones);
  const addressCount = most((data) => data.addresses);
  const urlCount = most((data) => data.urls);
  const header = [
    'First Name',
    'Middle Name',
    'Last Name',
    'Name Prefix',
    'Name Suffix',
    'Nickname',
    'Organization Name',
    'Organization Title',
    'Organization Department',
    'Birthday',
    'Notes',
    'Labels',
  ];
  for (let index = 1; index <= emailCount; index++) header.push(`E-mail ${index} - Label`, `E-mail ${index} - Value`);
  for (let index = 1; index <= phoneCount; index++) header.push(`Phone ${index} - Label`, `Phone ${index} - Value`);
  for (let index = 1; index <= addressCount; index++)
    header.push(
      `Address ${index} - Label`,
      `Address ${index} - Street`,
      `Address ${index} - City`,
      `Address ${index} - PO Box`,
      `Address ${index} - Region`,
      `Address ${index} - Postal Code`,
      `Address ${index} - Country`,
      `Address ${index} - Extended Address`
    );
  for (let index = 1; index <= urlCount; index++) header.push(`Website ${index} - Label`, `Website ${index} - Value`);
  const label = (entry: { type: EntryType; label: string | null }) => entry.label ?? TYPE_LABEL[entry.type];
  const lines = [csvLine(header)];
  for (const { row, data } of list) {
    const cells: unknown[] = [
      data.given || (data.family || data.organization ? '' : data.name),
      data.additional,
      data.family,
      data.prefix,
      data.suffix,
      data.nickname,
      data.organization,
      data.title,
      data.department,
      data.birthday ?? '',
      data.note,
      ['* myContacts', ...(starred.has(row.id) ? ['* starred'] : []), ...data.categories].join(' ::: '),
    ];
    for (let index = 0; index < emailCount; index++)
      cells.push(data.emails[index] ? label(data.emails[index]) : '', data.emails[index]?.value ?? '');
    for (let index = 0; index < phoneCount; index++)
      cells.push(data.phones[index] ? label(data.phones[index]) : '', data.phones[index]?.value ?? '');
    for (let index = 0; index < addressCount; index++) {
      const entry = data.addresses[index];
      cells.push(
        entry ? label(entry) : '',
        entry?.street ?? '',
        entry?.locality ?? '',
        entry?.pobox ?? '',
        entry?.region ?? '',
        entry?.code ?? '',
        entry?.country ?? '',
        entry?.extended ?? ''
      );
    }
    for (let index = 0; index < urlCount; index++)
      cells.push(data.urls[index] ? label(data.urls[index]) : '', data.urls[index]?.value ?? '');
    lines.push(csvLine(cells));
  }
  return csvDocument(lines);
}
