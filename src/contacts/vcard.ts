export interface VProp {
  group: string | null;
  name: string;
  params: Record<string, string[]>;
  value: string;
}

export interface VCard {
  props: VProp[];
}

export class VCardError extends Error {}

export type ContactKind = 'individual' | 'group' | 'org';
export type EntryType = 'home' | 'work' | 'mobile' | 'main' | 'fax' | 'pager' | 'other';

export interface Entry {
  type: EntryType;
  value: string;
  label: string | null;
}

export interface Address {
  type: EntryType;
  label: string | null;
  street: string;
  locality: string;
  region: string;
  code: string;
  country: string;
  pobox: string;
  extended: string;
}

export interface ContactData {
  kind: ContactKind;
  name: string;
  prefix: string;
  given: string;
  additional: string;
  family: string;
  suffix: string;
  nickname: string;
  organization: string;
  department: string;
  title: string;
  emails: Entry[];
  phones: Entry[];
  addresses: Address[];
  urls: Entry[];
  birthday: string | null;
  anniversary: string | null;
  note: string;
  categories: string[];
  members: string[];
  photo: boolean;
}

export const MAX_ENTRIES = 50;

const NAME = /^(?:([A-Za-z0-9-]+)\.)?([A-Za-z0-9-]+)/;
const ENCODINGS = new Set(['QUOTED-PRINTABLE', 'BASE64', 'B', '8BIT', '7BIT']);
const STRUCTURED = new Set(['N', 'ADR', 'ORG', 'GENDER', 'CLIENTPIDMAP']);
const APPLE = /^_\$!<(.+)>!\$_$/;

export function emptyContact(): ContactData {
  return {
    kind: 'individual',
    name: '',
    prefix: '',
    given: '',
    additional: '',
    family: '',
    suffix: '',
    nickname: '',
    organization: '',
    department: '',
    title: '',
    emails: [],
    phones: [],
    addresses: [],
    urls: [],
    birthday: null,
    anniversary: null,
    note: '',
    categories: [],
    members: [],
    photo: false,
  };
}

function headOf(line: string) {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === ':' && !quoted) return line.slice(0, index);
  }
  return line;
}

function logicalLines(text: string) {
  const physical = text
    .replace(/^﻿/, '')
    .replace(/\r\n|\r/g, '\n')
    .split('\n');
  const out: string[] = [];
  for (const line of physical) {
    const last = out.length ? out[out.length - 1] : undefined;
    if (last !== undefined && (line.startsWith(' ') || line.startsWith('\t'))) {
      out[out.length - 1] = last + line.slice(1);
      continue;
    }
    if (last !== undefined && last.endsWith('=') && /[;:]((ENCODING=)?QUOTED-PRINTABLE)[;:]/i.test(`${headOf(last)}:`)) {
      out[out.length - 1] = last.slice(0, -1) + line;
      continue;
    }
    out.push(line);
  }
  return out;
}

function caretDecode(value: string) {
  return value.replace(/\^([n'^])/g, (_match, char: string) => (char === 'n' ? '\n' : char === "'" ? '"' : '^'));
}

function parseLine(line: string): VProp | null {
  const match = NAME.exec(line);
  if (!match) return null;
  let index = match[0].length;
  const params: Record<string, string[]> = {};
  while (line[index] === ';') {
    index++;
    const key = /^[A-Za-z0-9-]+/.exec(line.slice(index));
    if (!key) return null;
    index += key[0].length;
    const upper = key[0].toUpperCase();
    if (line[index] !== '=') {
      if (ENCODINGS.has(upper)) params.ENCODING = [upper];
      else (params.TYPE ??= []).push(upper);
      continue;
    }
    index++;
    const values: string[] = [];
    for (;;) {
      if (line[index] === '"') {
        const end = line.indexOf('"', index + 1);
        if (end < 0) return null;
        values.push(caretDecode(line.slice(index + 1, end)));
        index = end + 1;
      } else {
        let end = index;
        while (end < line.length && line[end] !== ',' && line[end] !== ';' && line[end] !== ':') end++;
        values.push(caretDecode(line.slice(index, end)));
        index = end;
      }
      if (line[index] === ',') {
        index++;
        continue;
      }
      break;
    }
    (params[upper] ??= []).push(...values);
  }
  if (line[index] !== ':') return null;
  return { group: match[1] ?? null, name: match[2].toUpperCase(), params, value: line.slice(index + 1) };
}

function decodeQuotedPrintable(value: string) {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(index + 1, index + 3))) {
      bytes.push(parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (char === '=') continue;
    else for (const byte of Buffer.from(char, 'utf8')) bytes.push(byte);
  }
  return Buffer.from(bytes);
}

function decodeBytes(bytes: Buffer, charset: string | undefined) {
  const name = (charset ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(name === 'utf8' ? 'utf-8' : name, { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

function escapeLoose(text: string, structured: boolean) {
  let out = '';
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      const next = text[index + 1];
      if (next !== undefined && '\\;,nN'.includes(next)) {
        out += char + next;
        index++;
      } else out += '\\\\';
    } else if (char === '\r') continue;
    else if (char === '\n') out += '\\n';
    else if (char === ',') out += '\\,';
    else if (char === ';' && !structured) out += '\\;';
    else out += char;
  }
  return out;
}

function upgradeLegacy(prop: VProp) {
  const encoding = prop.params.ENCODING?.[0]?.toUpperCase();
  if (encoding === 'QUOTED-PRINTABLE') {
    const text = decodeBytes(decodeQuotedPrintable(prop.value), prop.params.CHARSET?.[0]);
    delete prop.params.ENCODING;
    prop.value = escapeLoose(text, STRUCTURED.has(prop.name));
  } else if (encoding === 'BASE64') prop.params.ENCODING = ['b'];
  delete prop.params.CHARSET;
}

export function parseVCards(text: string, limit = 50_000): VCard[] {
  const cards: VCard[] = [];
  let current: VCard | null = null;
  let depth = 0;
  for (const raw of logicalLines(text)) {
    if (!raw.trim()) continue;
    const prop = parseLine(raw);
    if (!prop) continue;
    if (prop.name === 'BEGIN' && prop.value.trim().toUpperCase() === 'VCARD') {
      if (current) {
        depth++;
        continue;
      }
      current = { props: [] };
      continue;
    }
    if (prop.name === 'END' && prop.value.trim().toUpperCase() === 'VCARD') {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (current) {
        for (const entry of current.props) upgradeLegacy(entry);
        cards.push(current);
        if (cards.length > limit) throw new VCardError('Die Datei enthält zu viele Kontakte');
      }
      current = null;
      continue;
    }
    if (current && depth === 0) current.props.push(prop);
  }
  return cards;
}

export function versionOf(card: VCard): '2.1' | '3.0' | '4.0' {
  const value = card.props.find((prop) => prop.name === 'VERSION')?.value.trim();
  return value === '4.0' ? '4.0' : value === '2.1' || value === '2.0' ? '2.1' : '3.0';
}

export function unescapeValue(value: string) {
  return value.replace(/\\([\s\S])/g, (_match, char: string) => (char === 'n' || char === 'N' ? '\n' : char));
}

export function splitValue(value: string, separator: ';' | ',') {
  const out: string[] = [];
  let current = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && index + 1 < value.length) {
      current += char + value[index + 1];
      index++;
    } else if (char === separator) {
      out.push(current);
      current = '';
    } else current += char;
  }
  out.push(current);
  return out;
}

const escapeValue = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

const structuredValue = (parts: string[]) => parts.map(escapeValue).join(';');

const textOf = (prop: VProp | undefined) => (prop ? unescapeValue(prop.value).trim() : '');

const partsOf = (prop: VProp | undefined, count: number) => {
  const parts = prop ? splitValue(prop.value, ';').map((part) => splitValue(part, ',').map(unescapeValue).join(', ').trim()) : [];
  while (parts.length < count) parts.push('');
  return parts;
};

const typesOf = (prop: VProp) =>
  new Set(
    (prop.params.TYPE ?? [])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
  );

function labelFor(card: VCard, prop: VProp) {
  if (!prop.group) return null;
  const label = card.props.find((entry) => entry.group?.toLowerCase() === prop.group!.toLowerCase() && entry.name === 'X-ABLABEL');
  return label ? unescapeValue(label.value).trim() : null;
}

const APPLE_TYPES: Record<string, EntryType> = {
  HOME: 'home',
  WORK: 'work',
  OTHER: 'other',
  MOBILE: 'mobile',
  IPHONE: 'mobile',
  MAIN: 'main',
  HOMEFAX: 'fax',
  WORKFAX: 'fax',
  OTHERFAX: 'fax',
  PAGER: 'pager',
  HOMEPAGE: 'home',
};

function entryType(types: Set<string>, kind: 'email' | 'phone' | 'address' | 'url'): EntryType {
  if (kind === 'phone') {
    if (types.has('FAX')) return 'fax';
    if (types.has('CELL') || types.has('MOBILE') || types.has('IPHONE')) return 'mobile';
    if (types.has('PAGER')) return 'pager';
    if (types.has('MAIN')) return 'main';
  }
  if (types.has('WORK')) return 'work';
  if (types.has('HOME')) return 'home';
  return 'other';
}

function classify(card: VCard, prop: VProp, kind: 'email' | 'phone' | 'address' | 'url') {
  const label = labelFor(card, prop);
  const types = typesOf(prop);
  if (label) {
    const apple = APPLE.exec(label);
    if (apple) {
      const key = apple[1].replace(/\s+/g, '').toUpperCase();
      if (APPLE_TYPES[key]) return { type: APPLE_TYPES[key], label: null };
      return { type: entryType(types, kind), label: apple[1] };
    }
    return { type: entryType(types, kind), label };
  }
  return { type: entryType(types, kind), label: null };
}

const preferred = (prop: VProp) => typesOf(prop).has('PREF') || (prop.params.PREF?.[0] !== undefined && Number(prop.params.PREF[0]) <= 1);

function ordered(props: VProp[]) {
  return [...props].sort((a, b) => Number(preferred(b)) - Number(preferred(a)));
}

export function normalizeDate(raw: string, params: Record<string, string[]> = {}): string | null {
  const value = raw.trim();
  if (!value) return null;
  const omit = params['X-APPLE-OMIT-YEAR']?.[0];
  const iso = /^(\d{4})-?(\d{2})-?(\d{2})(?:T.*)?$/.exec(value);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (!validDay(month, day)) return null;
    if ((omit && Number(omit) === year) || year < 1000 || year === 1604) return `--${iso[2]}-${iso[3]}`;
    if (new Date(Date.UTC(year, month - 1, day)).getUTCDate() !== day) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const noYear = /^--(\d{2})-?(\d{2})$/.exec(value);
  if (noYear) return validDay(Number(noYear[1]), Number(noYear[2])) ? `--${noYear[1]}-${noYear[2]}` : null;
  return null;
}

function validDay(month: number, day: number) {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function isDateValue(value: string) {
  return normalizeDate(value) === value;
}

function anniversaryOf(card: VCard) {
  const direct = card.props.find((prop) =>
    ['ANNIVERSARY', 'X-ANNIVERSARY', 'X-EVOLUTION-ANNIVERSARY', 'X-MS-ANNIVERSARY'].includes(prop.name)
  );
  if (direct) return normalizeDate(textOf(direct), direct.params);
  for (const prop of card.props) {
    if (prop.name !== 'X-ABDATE') continue;
    const label = labelFor(card, prop);
    if (label && /anniversary/i.test(label)) return normalizeDate(textOf(prop), prop.params);
  }
  return null;
}

function memberUid(value: string) {
  const text = unescapeValue(value).trim();
  return text.replace(/^urn:uuid:/i, '');
}

export function uidOf(card: VCard) {
  const prop = card.props.find((entry) => entry.name === 'UID');
  const value = prop ? unescapeValue(prop.value).trim() : '';
  return value || null;
}

export function displayName(data: Pick<ContactData, 'prefix' | 'given' | 'additional' | 'family' | 'suffix'>) {
  return [data.prefix, data.given, data.additional, data.family]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .concat(data.suffix.trim() ? `, ${data.suffix.trim()}` : '');
}

export function readContact(card: VCard): ContactData {
  const data = emptyContact();
  const get = (name: string) => card.props.find((prop) => prop.name === name);
  const list = (name: string) => card.props.filter((prop) => prop.name === name);
  const [family, given, additional, prefix, suffix] = partsOf(get('N'), 5);
  Object.assign(data, { family, given, additional, prefix, suffix });
  data.nickname = textOf(get('NICKNAME'));
  const org = partsOf(get('ORG'), 1);
  data.organization = org[0];
  data.department = org.slice(1).filter(Boolean).join(', ');
  data.title = textOf(get('TITLE'));
  data.note = textOf(get('NOTE'));
  const kind = (textOf(get('KIND')) || textOf(get('X-ADDRESSBOOKSERVER-KIND'))).toLowerCase();
  data.kind = kind === 'group' ? 'group' : kind === 'org' || textOf(get('X-ABSHOWAS')).toUpperCase() === 'COMPANY' ? 'org' : 'individual';
  for (const prop of ordered(list('EMAIL'))) {
    const value = textOf(prop).replace(/^mailto:/i, '');
    if (value && data.emails.length < MAX_ENTRIES) data.emails.push({ ...classify(card, prop, 'email'), value });
  }
  for (const prop of ordered(list('TEL'))) {
    const value = textOf(prop).replace(/^tel:/i, '');
    if (value && data.phones.length < MAX_ENTRIES) data.phones.push({ ...classify(card, prop, 'phone'), value });
  }
  for (const prop of ordered(list('ADR'))) {
    const [pobox, extended, street, locality, region, code, country] = partsOf(prop, 7);
    if (![pobox, extended, street, locality, region, code, country].some(Boolean) || data.addresses.length >= MAX_ENTRIES) continue;
    data.addresses.push({ ...classify(card, prop, 'address'), pobox, extended, street, locality, region, code, country });
  }
  for (const prop of ordered(list('URL'))) {
    const value = textOf(prop);
    if (value && data.urls.length < MAX_ENTRIES) data.urls.push({ ...classify(card, prop, 'url'), value });
  }
  const birthday = get('BDAY');
  data.birthday = birthday ? normalizeDate(textOf(birthday), birthday.params) : null;
  data.anniversary = anniversaryOf(card);
  data.categories = [
    ...new Set(
      list('CATEGORIES')
        .flatMap((prop) => splitValue(prop.value, ',').map(unescapeValue))
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_ENTRIES);
  data.members = [...list('MEMBER'), ...list('X-ADDRESSBOOKSERVER-MEMBER')].map((prop) => memberUid(prop.value)).filter(Boolean);
  data.photo = Boolean(photoOf(card));
  const formatted = textOf(get('FN'));
  data.name = formatted || displayName(data) || data.organization || data.nickname || data.emails[0]?.value || data.phones[0]?.value || '';
  return data;
}

const MANAGED = new Set([
  'VERSION',
  'PRODID',
  'UID',
  'FN',
  'N',
  'NICKNAME',
  'ORG',
  'TITLE',
  'EMAIL',
  'TEL',
  'ADR',
  'URL',
  'BDAY',
  'ANNIVERSARY',
  'X-ANNIVERSARY',
  'X-EVOLUTION-ANNIVERSARY',
  'X-MS-ANNIVERSARY',
  'NOTE',
  'CATEGORIES',
  'KIND',
  'X-ADDRESSBOOKSERVER-KIND',
  'X-ABSHOWAS',
  'REV',
]);

const TYPE_PARAMS: Record<'email' | 'phone' | 'address' | 'url', Record<EntryType, string[]>> = {
  email: { home: ['HOME'], work: ['WORK'], other: [], mobile: [], main: [], fax: [], pager: [] },
  phone: {
    home: ['HOME', 'VOICE'],
    work: ['WORK', 'VOICE'],
    mobile: ['CELL'],
    main: ['MAIN'],
    fax: ['FAX'],
    pager: ['PAGER'],
    other: ['VOICE'],
  },
  address: { home: ['HOME'], work: ['WORK'], other: [], mobile: [], main: [], fax: [], pager: [] },
  url: { home: ['HOME'], work: ['WORK'], other: [], mobile: [], main: [], fax: [], pager: [] },
};

function writeDate(value: string, version: '3.0' | '4.0', name: string): VProp {
  const noYear = /^--(\d{2})-(\d{2})$/.exec(value);
  if (noYear) {
    if (version === '4.0') return { group: null, name, params: {}, value: `--${noYear[1]}${noYear[2]}` };
    return { group: null, name, params: { 'X-APPLE-OMIT-YEAR': ['1604'] }, value: `1604-${noYear[1]}-${noYear[2]}` };
  }
  return {
    group: null,
    name,
    params: version === '4.0' ? {} : { VALUE: ['date'] },
    value: version === '4.0' ? value.replace(/-/g, '') : value,
  };
}

const stamp = (now = new Date()) =>
  `${now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')}`;

export function applyContact(base: VCard | null, input: ContactData, uid: string, version?: '3.0' | '4.0'): VCard {
  const card: VCard = base ? { props: base.props.map((prop) => ({ ...prop, params: { ...prop.params } })) } : { props: [] };
  const target = version ?? (base && versionOf(base) === '4.0' ? '4.0' : '3.0');
  const managedGroups = new Set<string>();
  for (const prop of card.props) {
    if (!prop.group) continue;
    const anniversary = prop.name === 'X-ABDATE' && /anniversary/i.test(labelFor(card, prop) ?? '');
    if (MANAGED.has(prop.name) || anniversary) managedGroups.add(prop.group.toLowerCase());
  }
  const kept = card.props.filter((prop) => !MANAGED.has(prop.name) && !(prop.group && managedGroups.has(prop.group.toLowerCase())));
  let counter = 0;
  for (const prop of kept) {
    const match = /^item(\d+)$/i.exec(prop.group ?? '');
    if (match) counter = Math.max(counter, Number(match[1]));
  }
  const nextGroup = () => `item${++counter}`;
  const data = sanitize(input);
  const out: VProp[] = [];
  const add = (name: string, value: string, params: Record<string, string[]> = {}, group: string | null = null) => {
    out.push({ group, name, params, value });
  };
  add('VERSION', target);
  add('PRODID', '-//MoeCloud//Kontakte//DE');
  add('UID', escapeValue(uid));
  const name = data.name || displayName(data) || data.organization || data.emails[0]?.value || data.phones[0]?.value || '';
  add('FN', escapeValue(name));
  if (target === '3.0' || data.family || data.given || data.additional || data.prefix || data.suffix)
    add('N', structuredValue([data.family, data.given, data.additional, data.prefix, data.suffix]));
  if (data.nickname) add('NICKNAME', escapeValue(data.nickname));
  if (data.organization || data.department) add('ORG', structuredValue([data.organization, ...(data.department ? [data.department] : [])]));
  if (data.title) add('TITLE', escapeValue(data.title));
  if (data.kind === 'org') {
    if (target === '4.0') add('KIND', 'org');
    else add('X-ABSHOWAS', 'COMPANY');
  }
  if (data.kind === 'group') {
    if (target === '4.0') add('KIND', 'group');
    else add('X-ADDRESSBOOKSERVER-KIND', 'group');
  }
  const entries = (
    kind: 'email' | 'phone' | 'address' | 'url',
    name: string,
    list: { type: EntryType; label: string | null; value: string }[]
  ) => {
    list.forEach((entry, index) => {
      const types = [...TYPE_PARAMS[kind][entry.type]];
      if (kind === 'email' && target === '3.0') types.unshift('INTERNET');
      const params: Record<string, string[]> = {};
      if (index === 0 && list.length > 1) {
        if (target === '4.0') params.PREF = ['1'];
        else types.push('PREF');
      }
      if (types.length) params.TYPE = target === '4.0' ? types.map((type) => type.toLowerCase()) : types;
      if (entry.label) {
        const group = nextGroup();
        add(name, entry.value, params, group);
        add('X-ABLABEL', escapeValue(entry.label), {}, group);
      } else add(name, entry.value, params);
    });
  };
  entries(
    'email',
    'EMAIL',
    data.emails.map((entry) => ({ ...entry, value: escapeValue(entry.value) }))
  );
  entries(
    'phone',
    'TEL',
    data.phones.map((entry) => ({ ...entry, value: escapeValue(entry.value) }))
  );
  entries(
    'address',
    'ADR',
    data.addresses.map((entry) => ({
      type: entry.type,
      label: entry.label,
      value: structuredValue([entry.pobox, entry.extended, entry.street, entry.locality, entry.region, entry.code, entry.country]),
    }))
  );
  entries(
    'url',
    'URL',
    data.urls.map((entry) => ({ ...entry, value: entry.value.replace(/[\r\n]+/g, '') }))
  );
  if (data.birthday) out.push(writeDate(data.birthday, target, 'BDAY'));
  if (data.anniversary) {
    if (target === '4.0') out.push(writeDate(data.anniversary, target, 'ANNIVERSARY'));
    else {
      const full = /^\d{4}-\d{2}-\d{2}$/.test(data.anniversary);
      out.push(writeDate(data.anniversary, target, 'X-ANNIVERSARY'));
      if (full) {
        const group = nextGroup();
        add('X-ABDATE', data.anniversary, {}, group);
        add('X-ABLABEL', '_$!<Anniversary>!$_', {}, group);
      }
    }
  }
  if (data.note) add('NOTE', escapeValue(data.note));
  if (data.categories.length) add('CATEGORIES', data.categories.map(escapeValue).join(','));
  card.props = [
    ...out,
    ...kept.filter((prop) => target === '4.0' || prop.name !== 'MEMBER'),
    { group: null, name: 'REV', params: {}, value: stamp() },
  ];
  if (target === '3.0' && data.kind === 'group') {
    const members = kept.some((prop) => prop.name === 'X-ADDRESSBOOKSERVER-MEMBER');
    if (!members)
      for (const member of data.members)
        card.props.push({ group: null, name: 'X-ADDRESSBOOKSERVER-MEMBER', params: {}, value: `urn:uuid:${member}` });
  }
  return card;
}

const clean = (value: unknown, max: number) =>
  typeof value === 'string'
    ? value
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, max)
    : '';

const line = (value: unknown, max: number) => clean(value, max).replace(/[\r\n]+/g, ' ');

export function sanitize(input: ContactData): ContactData {
  const kind: ContactKind = input.kind === 'group' || input.kind === 'org' ? input.kind : 'individual';
  const type = (value: unknown): EntryType =>
    (['home', 'work', 'mobile', 'main', 'fax', 'pager', 'other'] as const).includes(value as EntryType) ? (value as EntryType) : 'other';
  const entry = (item: Entry, max: number) => ({
    type: type(item.type),
    value: line(item.value, max),
    label: line(item.label, 60) || null,
  });
  return {
    kind,
    name: line(input.name, 300),
    prefix: line(input.prefix, 60),
    given: line(input.given, 120),
    additional: line(input.additional, 120),
    family: line(input.family, 120),
    suffix: line(input.suffix, 60),
    nickname: line(input.nickname, 120),
    organization: line(input.organization, 200),
    department: line(input.department, 200),
    title: line(input.title, 200),
    emails: (input.emails ?? [])
      .slice(0, MAX_ENTRIES)
      .map((item) => entry(item, 254))
      .filter((item) => item.value),
    phones: (input.phones ?? [])
      .slice(0, MAX_ENTRIES)
      .map((item) => entry(item, 60))
      .filter((item) => item.value),
    addresses: (input.addresses ?? [])
      .slice(0, MAX_ENTRIES)
      .map((item) => ({
        type: type(item.type),
        label: line(item.label, 60) || null,
        street: clean(item.street, 300),
        locality: line(item.locality, 120),
        region: line(item.region, 120),
        code: line(item.code, 30),
        country: line(item.country, 120),
        pobox: line(item.pobox, 60),
        extended: line(item.extended, 200),
      }))
      .filter((item) => [item.street, item.locality, item.region, item.code, item.country, item.pobox, item.extended].some(Boolean)),
    urls: (input.urls ?? [])
      .slice(0, MAX_ENTRIES)
      .map((item) => entry(item, 2000))
      .filter((item) => item.value),
    birthday: input.birthday && normalizeDate(input.birthday) === input.birthday ? input.birthday : null,
    anniversary: input.anniversary && normalizeDate(input.anniversary) === input.anniversary ? input.anniversary : null,
    note: clean(input.note, 20_000),
    categories: [...new Set((input.categories ?? []).map((value) => line(value, 60)).filter(Boolean))].slice(0, MAX_ENTRIES),
    members: (input.members ?? []).map((value) => line(value, 200)).filter(Boolean),
    photo: Boolean(input.photo),
  };
}

const SAFE_PARAM = /^[^";:,]*$/;

function paramValue(value: string) {
  const clean = value.replace(/"/g, "'").replace(/[\r\n]/g, ' ');
  return SAFE_PARAM.test(clean) ? clean : `"${clean}"`;
}

function fold(text: string) {
  if (Buffer.byteLength(text, 'utf8') <= 75) return text;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const char of text) {
    const length = Buffer.byteLength(char, 'utf8');
    if (size + length > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74;
    }
    current += char;
    size += length;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function propLine(prop: VProp) {
  let text = prop.group ? `${prop.group}.${prop.name}` : prop.name;
  for (const [key, values] of Object.entries(prop.params)) text += `;${key}=${values.map(paramValue).join(',')}`;
  return fold(`${text}:${prop.value.replace(/[\r\n]+/g, ' ')}`);
}

export function serializeVCard(card: VCard) {
  const version = card.props.find((prop) => prop.name === 'VERSION');
  const rest = card.props.filter((prop) => prop.name !== 'VERSION' && prop.name !== 'BEGIN' && prop.name !== 'END');
  const lines = ['BEGIN:VCARD', ...(version ? [propLine(version)] : ['VERSION:3.0']), ...rest.map(propLine), 'END:VCARD'];
  return `${lines.join('\r\n')}\r\n`;
}

function sniff(data: Buffer) {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length > 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length > 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (data.length > 12 && data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  return null;
}

export function photoOf(card: VCard): { type: string; data: Buffer } | null {
  const prop = card.props.find((entry) => entry.name === 'PHOTO');
  if (!prop) return null;
  const value = prop.value.trim();
  let data: Buffer | null = null;
  const uri = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(value);
  if (uri) data = uri[2] ? Buffer.from(uri[3].replace(/\s+/g, ''), 'base64') : Buffer.from(decodeURIComponent(uri[3]), 'latin1');
  else {
    const encoding = prop.params.ENCODING?.[0]?.toUpperCase();
    if (encoding === 'B' || encoding === 'BASE64') data = Buffer.from(value.replace(/\s+/g, ''), 'base64');
  }
  if (!data || !data.length) return null;
  const type = sniff(data);
  return type ? { type, data } : null;
}

export function setPhoto(card: VCard, jpeg: Buffer | null) {
  card.props = card.props.filter((prop) => prop.name !== 'PHOTO');
  if (!jpeg) return;
  const base64 = jpeg.toString('base64');
  if (versionOf(card) === '4.0') card.props.push({ group: null, name: 'PHOTO', params: {}, value: `data:image/jpeg;base64,${base64}` });
  else card.props.push({ group: null, name: 'PHOTO', params: { ENCODING: ['b'], TYPE: ['JPEG'] }, value: base64 });
}

export function setUid(card: VCard, uid: string) {
  card.props = card.props.filter((prop) => prop.name !== 'UID');
  const index = card.props.findIndex((prop) => prop.name === 'VERSION');
  card.props.splice(index + 1, 0, { group: null, name: 'UID', params: {}, value: escapeValue(uid) });
}

export function ensureName(card: VCard) {
  const fn = card.props.find((prop) => prop.name === 'FN');
  if (fn && unescapeValue(fn.value).trim()) return;
  const data = readContact(card);
  card.props = card.props.filter((prop) => prop.name !== 'FN');
  card.props.push({ group: null, name: 'FN', params: {}, value: escapeValue(data.name) });
  if (versionOf(card) !== '4.0' && !card.props.some((prop) => prop.name === 'N'))
    card.props.push({ group: null, name: 'N', params: {}, value: structuredValue(['', data.name, '', '', '']) });
}

export function upgradeCard(card: VCard) {
  if (versionOf(card) !== '2.1') return card;
  const data = readContact(card);
  const uid = uidOf(card) ?? '';
  const next = applyContact(card, data, uid, '3.0');
  return next;
}
