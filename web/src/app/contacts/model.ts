import { api, csrfToken } from '../../lib/api';
import { locale, t } from '../../lib/i18n';

export type EntryType = 'home' | 'work' | 'mobile' | 'main' | 'fax' | 'pager' | 'other';
export type Access = 'owner' | 'write' | 'read';

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
  kind: 'individual' | 'group' | 'org';
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

export interface Summary {
  id: string;
  bookId: string;
  kind: ContactData['kind'];
  name: string;
  given: string;
  family: string;
  organization: string;
  title: string;
  email: string | null;
  phone: string | null;
  photo: string | null;
  favorite: boolean;
  categories: string[];
  birthday: string | null;
  readOnly: boolean;
  trashedAt: number | null;
}

export interface Detail {
  id: string;
  bookId: string;
  uid: string;
  data: ContactData;
  photo: string | null;
  favorite: boolean;
  readOnly: boolean;
  version: string;
  accounts: { id: number; name: string; initials: string }[];
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  createdBy: { id: number; name: string } | null;
  updatedBy: { id: number; name: string } | null;
}

export interface Book {
  id: string;
  name: string;
  description: string;
  access: Access;
  count: number;
  shares: number;
  owner: { id: number; name: string; initials: string } | null;
}

export interface Label {
  name: string;
  count: number;
}

export interface Group {
  id: string;
  bookId: string;
  name: string;
  count: number;
}

export interface Birthday {
  contactId: string;
  name: string;
  date: string;
  year: number | null;
  age: number | null;
  photo: string | null;
}

export interface ImportJob {
  id: string;
  count: number;
  groups: number;
  files: string[];
  sample: { name: string; email: string | null; phone: string | null }[];
  warnings: { message: string; params: Record<string, string | number> }[];
}

export const PHONE_TYPES: EntryType[] = ['mobile', 'home', 'work', 'main', 'fax', 'pager', 'other'];
export const EMAIL_TYPES: EntryType[] = ['home', 'work', 'other'];

export function typeLabel(type: EntryType) {
  switch (type) {
    case 'home':
      return t('Privat');
    case 'work':
      return t('Arbeit');
    case 'mobile':
      return t('Mobil');
    case 'main':
      return t('Hauptnummer');
    case 'fax':
      return t('Fax');
    case 'pager':
      return t('Pager');
    default:
      return t('Sonstige');
  }
}

export const entryLabel = (entry: { type: EntryType; label: string | null }) => entry.label || typeLabel(entry.type);

export function emptyData(): ContactData {
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

export function composeName(data: Pick<ContactData, 'prefix' | 'given' | 'additional' | 'family' | 'suffix'>) {
  const main = [data.prefix, data.given, data.additional, data.family]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
  return data.suffix.trim() ? `${main}, ${data.suffix.trim()}` : main;
}

export function initialsOf(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)).toUpperCase();
}

export const shownName = (entry: { name: string }) => entry.name || t('Ohne Namen');

export function sortKey(entry: Pick<Summary, 'name' | 'given' | 'family' | 'organization' | 'kind'>, order: 'first' | 'last') {
  if (order === 'last' && entry.kind !== 'org' && entry.family) return `${entry.family} ${entry.given}`.trim();
  return entry.name || entry.organization || '';
}

const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });

export const compareText = (a: string, b: string) => collator.compare(a, b);

export function letterOf(key: string) {
  const first = key.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

export const photoUrl = (id: string, etag: string) => `/api/contacts/${id}/photo?v=${encodeURIComponent(etag)}`;

export function parseDay(value: string) {
  const match = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: match[1] === '-' ? null : Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatDay(value: string, withYear = true) {
  const parts = parseDay(value);
  if (!parts) return value;
  const date = new Date(Date.UTC(parts.year ?? 2000, parts.month - 1, parts.day));
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(parts.year && withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(date);
}

export function nextOccurrence(value: string, today = new Date()) {
  const parts = parseDay(value);
  if (!parts) return null;
  const base = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  for (let year = today.getFullYear(); year <= today.getFullYear() + 1; year++) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const day = parts.month === 2 && parts.day === 29 && !leap ? 28 : parts.day;
    const when = Date.UTC(year, parts.month - 1, day);
    if (when >= base) {
      return {
        days: Math.round((when - base) / 86_400_000),
        age: parts.year ? year - parts.year : null,
        date: new Date(when),
      };
    }
  }
  return null;
}

export function ageNow(value: string, today = new Date()) {
  const parts = parseDay(value);
  if (!parts?.year) return null;
  let age = today.getFullYear() - parts.year;
  if (today.getMonth() + 1 < parts.month || (today.getMonth() + 1 === parts.month && today.getDate() < parts.day)) age--;
  return age >= 0 && age < 150 ? age : null;
}

export function addressLines(address: Address) {
  const city = [address.code, address.locality].filter(Boolean).join(' ');
  return [
    address.extended,
    address.street,
    address.pobox ? t('Postfach {box}', { box: address.pobox }) : '',
    city,
    address.region,
    address.country,
  ]
    .map((line) => line.trim())
    .filter(Boolean);
}

export const mapUrl = (address: Address) =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(addressLines(address).join(', '))}`;

export const telUrl = (value: string) => `tel:${value.replace(/[^\d+*#,;]/g, '')}`;

export function webUrl(value: string) {
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(text)) return `https://${text}`;
  return null;
}

export async function sendForm<T>(method: 'POST' | 'PUT', url: string, files: { field: string; file: File | Blob; name: string }[]) {
  const body = new FormData();
  for (const entry of files) body.append(entry.field, entry.file, entry.name);
  const response = await fetch(url, {
    method,
    body,
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal'));
  return data as T;
}

export const contactsApi = {
  books: () => api.get<{ books: Book[] }>('/api/contacts/books').then((result) => result.books),
  labels: () => api.get<{ labels: Label[]; groups: Group[] }>('/api/contacts/labels'),
  list: (query: string) => api.get<{ items: Summary[]; trashDays: number }>(`/api/contacts${query}`),
  detail: (id: string) => api.get<{ contact: Detail }>(`/api/contacts/${id}`).then((result) => result.contact),
  create: (bookId: string, data: ContactData) =>
    api.post<{ contact: Detail }>('/api/contacts', { bookId, data }).then((result) => result.contact),
  update: (id: string, data: ContactData, bookId?: string) =>
    api.put<{ contact: Detail }>(`/api/contacts/${id}`, { data, bookId }).then((result) => result.contact),
  favorite: (id: string, favorite: boolean) => api.post(`/api/contacts/${id}/favorite`, { favorite }),
  remove: (ids: string[]) => api.post<{ trashed: boolean; days: number }>('/api/contacts/delete', { ids }),
  restore: (id: string) => api.post(`/api/contacts/${id}/restore`),
  destroy: (id: string) => api.delete(`/api/contacts/${id}/forever`),
  emptyTrash: () => api.delete<{ deleted: number }>('/api/contacts/trash'),
  move: (ids: string[], book: string) => api.post<{ moved: number }>('/api/contacts/move', { ids, book }),
  label: (ids: string[], label: string, add = true) => api.post<{ changed: number }>('/api/contacts/labels', { ids, label, add }),
  renameLabel: (from: string, to: string | null) => api.patch<{ changed: number }>('/api/contacts/labels', { from, to }),
  birthdays: (from: string, to: string) =>
    api.get<{ items: Birthday[] }>(`/api/contacts/birthdays?from=${from}&to=${to}`).then((result) => result.items),
  duplicates: () =>
    api.get<{ groups: { reasons: string[]; items: Summary[] }[] }>('/api/contacts/duplicates').then((result) => result.groups),
  merge: (ids: string[]) => api.post<{ contact: Detail }>('/api/contacts/merge', { ids }).then((result) => result.contact),
  createBook: (name: string) => api.post<{ book: Book }>('/api/contacts/books', { name }).then((result) => result.book),
  renameBook: (id: string, name: string) => api.patch(`/api/contacts/books/${id}`, { name }),
  removeBook: (id: string) => api.delete<{ left: boolean }>(`/api/contacts/books/${id}`),
  shares: (id: string) =>
    api
      .get<{
        shares: {
          user: { id: number; username: string; name: string; initials: string; avatar: string | null };
          permission: 'read' | 'write';
        }[];
      }>(`/api/contacts/books/${id}/shares`)
      .then((result) => result.shares),
  share: (id: string, user: number, permission: 'read' | 'write') => api.put(`/api/contacts/books/${id}/shares/${user}`, { permission }),
  unshare: (id: string, user: number) => api.delete(`/api/contacts/books/${id}/shares/${user}`),
  photo: (id: string, file: File) =>
    sendForm<{ contact: Detail }>('PUT', `/api/contacts/${id}/photo`, [{ field: 'file', file, name: file.name }]).then(
      (result) => result.contact
    ),
  removePhoto: (id: string) => api.delete<{ contact: Detail }>(`/api/contacts/${id}/photo`).then((result) => result.contact),
  importFiles: (files: File[]) =>
    sendForm<{ job: ImportJob }>(
      'POST',
      '/api/contacts/import',
      files.map((file) => ({ field: 'files', file, name: file.name }))
    ).then((result) => result.job),
  importNode: (node: string) => api.post<{ job: ImportJob }>('/api/contacts/import', { node }).then((result) => result.job),
  runImport: (id: string, book: string, name: string, mode: 'merge' | 'skip' | 'copy') =>
    api.post<{ created: number; updated: number; skipped: number; book: Book }>(`/api/contacts/import/${id}/run`, { book, name, mode }),
  discardImport: (id: string) => api.delete(`/api/contacts/import/${id}`),
};
