import { createHash, randomUUID } from 'node:crypto';
import { all, IN_LIST, one, run, tx, type Param } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.ts';
import { loadSharp } from '../lib/sharp.ts';
import * as settings from '../services/settings.ts';
import { getUser, inactive, initials, type UserRow } from '../services/users.ts';
import {
  announceContacts,
  bookMembers,
  canAt,
  getBook,
  requireBook,
  touchBook,
  visibleBooks,
  type BookAccess,
  type BookRow,
} from './books.ts';
import {
  applyContact,
  emptyContact,
  ensureName,
  parseVCards,
  photoOf,
  readContact,
  sanitize,
  serializeVCard,
  setPhoto,
  setUid,
  uidOf,
  upgradeCard,
  versionOf,
  type ContactData,
  type VCard,
} from './vcard.ts';

export interface ContactRow {
  id: string;
  book_id: string;
  uid: string;
  href: string;
  kind: string;
  name: string;
  search: string;
  birthday: string | null;
  data: string;
  vcard: string;
  etag: string;
  created_by: number | null;
  updated_by: number | null;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

const DAY = 86_400_000;

export const etagOf = (text: string) => createHash('sha256').update(text).digest('base64url').slice(0, 27);

export const dataOf = (row: Pick<ContactRow, 'data'>): ContactData => ({ ...emptyContact(), ...(JSON.parse(row.data) as ContactData) });

export const getContact = (id: string) => one<ContactRow>('SELECT * FROM contacts WHERE id = ?', id);

export const contactByHref = (bookId: string, href: string) =>
  one<ContactRow>('SELECT * FROM contacts WHERE book_id = ? AND href = ?', bookId, href);

export const liveByUid = (bookId: string, uid: string) =>
  one<ContactRow>('SELECT * FROM contacts WHERE book_id = ? AND uid = ? AND trashed_at IS NULL', bookId, uid);

export const cardOf = (row: Pick<ContactRow, 'vcard'>): VCard => parseVCards(row.vcard, 1)[0] ?? { props: [] };

const escapeLike = (value: string) => value.replace(/[%_\\]/g, (char) => `\\${char}`);

export const normalEmail = (value: string) => value.trim().toLowerCase();

export const phoneKey = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(-9) : '';
};

function searchText(data: ContactData) {
  return [
    data.name,
    data.nickname,
    data.given,
    data.family,
    data.organization,
    data.department,
    data.title,
    ...data.emails.map((entry) => entry.value),
    ...data.phones.flatMap((entry) => [entry.value, entry.value.replace(/[^\d+]/g, '')]),
    ...data.addresses.flatMap((entry) => [entry.street, entry.locality, entry.region, entry.code, entry.country]),
    ...data.categories,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .slice(0, 4000);
}

function hrefFor(bookId: string, uid: string, current?: string) {
  const base =
    uid
      .replace(/^urn:uuid:/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .slice(0, 100) || randomId(16);
  let href = `${base}.vcf`;
  while (true) {
    const taken = contactByHref(bookId, href);
    if (!taken || taken.id === current) return href;
    href = `${base}-${randomId(6)}.vcf`;
  }
}

export interface StoreOptions {
  actor: number | null;
  previous?: ContactRow | null;
  href?: string;
  text?: string;
}

export function storeCard(book: BookRow, card: VCard, options: StoreOptions): ContactRow {
  const previous = options.previous ?? null;
  let uid = uidOf(card);
  if (!uid) {
    uid = previous?.uid ?? randomUUID();
    setUid(card, uid);
  }
  const data = readContact(card);
  const text = options.text ?? serializeVCard(card);
  const etag = etagOf(text);
  const now = Date.now();
  const href = options.href ?? previous?.href ?? hrefFor(book.id, uid);
  const json = JSON.stringify(data);
  const search = searchText(data);
  let id: string;
  if (previous) {
    id = previous.id;
    run(
      `UPDATE contacts SET book_id = ?, uid = ?, href = ?, kind = ?, name = ?, search = ?, birthday = ?, data = ?, vcard = ?, etag = ?,
         updated_by = ?, updated_at = ?, trashed_at = NULL WHERE id = ?`,
      book.id,
      uid,
      href,
      data.kind,
      data.name.slice(0, 300),
      search,
      data.birthday,
      json,
      text,
      etag,
      options.actor,
      now,
      id
    );
  } else {
    id = randomId(16);
    run(
      `INSERT INTO contacts (id, book_id, uid, href, kind, name, search, birthday, data, vcard, etag, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      book.id,
      uid,
      href,
      data.kind,
      data.name.slice(0, 300),
      search,
      data.birthday,
      json,
      text,
      etag,
      options.actor,
      options.actor,
      now,
      now
    );
  }
  run('DELETE FROM contact_emails WHERE contact_id = ?', id);
  for (const email of new Set(data.emails.map((entry) => normalEmail(entry.value)).filter(Boolean)))
    run('INSERT INTO contact_emails (contact_id, email) VALUES (?, ?) ON CONFLICT DO NOTHING', id, email.slice(0, 254));
  touchBook(book.id, href);
  return getContact(id)!;
}

export function requireContact(user: UserRow, id: string, level: BookAccess = 'read') {
  const row = getContact(id);
  const book = row ? getBook(row.book_id) : undefined;
  if (!row || !book) throw notFound('Diesen Kontakt gibt es nicht');
  let access: BookAccess;
  try {
    access = requireBook(user, book.id, 'read').access;
  } catch {
    throw notFound('Diesen Kontakt gibt es nicht');
  }
  if (!canAt(access, level)) throw forbidden('In diesem Adressbuch darfst du nur lesen');
  return { row, book, access };
}

export function starredIds(user: UserRow) {
  return new Set(
    all<{ contact_id: string }>('SELECT contact_id FROM contact_stars WHERE user_id = ?', user.id).map((row) => row.contact_id)
  );
}

export function summarize(row: ContactRow, access: BookAccess, stars: Set<string>) {
  const data = dataOf(row);
  return {
    id: row.id,
    bookId: row.book_id,
    kind: data.kind,
    name: data.name,
    given: data.given,
    family: data.family,
    organization: data.organization,
    title: data.title,
    email: data.emails[0]?.value ?? null,
    phone: data.phones[0]?.value ?? null,
    photo: data.photo ? row.etag : null,
    favorite: stars.has(row.id),
    categories: data.categories,
    birthday: data.birthday,
    readOnly: access === 'read',
    trashedAt: row.trashed_at,
  };
}

export interface ContactFilter {
  book?: string;
  q?: string;
  label?: string;
  group?: string;
  favorites?: boolean;
  trash?: boolean;
}

export function listContacts(user: UserRow, filter: ContactFilter = {}) {
  const books = new Map(visibleBooks(user).map((entry) => [entry.book.id, entry]));
  const ids = filter.book ? (books.has(filter.book) ? [filter.book] : []) : [...books.keys()];
  if (!ids.length) return [];
  const params: Param[] = [JSON.stringify(ids)];
  let sql = `SELECT * FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS ${filter.trash ? 'NOT NULL' : 'NULL'}`;
  if (!filter.trash) sql += " AND kind != 'group'";
  const q = filter.q?.trim().toLowerCase();
  if (q) {
    for (const word of q.split(/\s+/).slice(0, 5)) {
      sql += " AND search LIKE ? ESCAPE '\\'";
      params.push(`%${escapeLike(word)}%`);
    }
  }
  if (filter.favorites) {
    sql += ' AND id IN (SELECT contact_id FROM contact_stars WHERE user_id = ?)';
    params.push(user.id);
  }
  let rows = all<ContactRow>(`${sql} ORDER BY name LIMIT 20000`, ...params);
  if (filter.label) {
    const label = filter.label.toLowerCase();
    rows = rows.filter((row) => dataOf(row).categories.some((entry) => entry.toLowerCase() === label));
  }
  if (filter.group) {
    const group = getContact(filter.group);
    if (!group || !books.has(group.book_id) || group.kind !== 'group') return [];
    const members = new Set(dataOf(group).members);
    rows = rows.filter((row) => row.book_id === group.book_id && members.has(row.uid));
  }
  const stars = starredIds(user);
  return rows.map((row) => summarize(row, books.get(row.book_id)!.access, stars));
}

export function listLabels(user: UserRow) {
  const books = visibleBooks(user);
  if (!books.length) return { labels: [], groups: [] };
  const rows = all<ContactRow>(
    `SELECT id, book_id, kind, name, data, uid FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NULL`,
    JSON.stringify(books.map((entry) => entry.book.id))
  );
  const labels = new Map<string, { name: string; count: number }>();
  const uids = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.kind === 'group') continue;
    let set = uids.get(row.book_id);
    if (!set) uids.set(row.book_id, (set = new Set()));
    set.add(row.uid);
    for (const label of dataOf(row).categories) {
      const key = label.toLowerCase();
      const entry = labels.get(key);
      if (entry) entry.count++;
      else labels.set(key, { name: label, count: 1 });
    }
  }
  const groups = rows
    .filter((row) => row.kind === 'group')
    .map((row) => {
      const members = uids.get(row.book_id) ?? new Set<string>();
      return { id: row.id, bookId: row.book_id, name: row.name, count: dataOf(row).members.filter((uid) => members.has(uid)).length };
    });
  return {
    labels: [...labels.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    groups: groups.sort((a, b) => a.name.localeCompare(b.name, 'de')),
  };
}

function person(id: number | null) {
  if (!id) return null;
  const user = getUser(id);
  return user ? { id: user.id, name: user.name } : null;
}

export function presentContact(user: UserRow, row: ContactRow, access: BookAccess) {
  const data = dataOf(row);
  const emails = data.emails.map((entry) => normalEmail(entry.value));
  const accounts =
    emails.length && (settings.get('users.directory') || user.role === 'admin')
      ? all<UserRow>(`SELECT * FROM users WHERE LOWER(email) ${IN_LIST} AND role != 'guest' LIMIT 3`, JSON.stringify(emails)).filter(
          (entry) => !inactive(entry) && entry.id !== user.id
        )
      : [];
  return {
    id: row.id,
    bookId: row.book_id,
    uid: row.uid,
    data,
    photo: data.photo ? row.etag : null,
    favorite: Boolean(one('SELECT 1 FROM contact_stars WHERE user_id = ? AND contact_id = ?', user.id, row.id)),
    readOnly: access === 'read',
    version: versionOf(cardOf(row)),
    accounts: accounts.map((entry) => ({ id: entry.id, name: entry.name, initials: initials(entry.name) })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
    createdBy: person(row.created_by),
    updatedBy: person(row.updated_by),
  };
}

function saveData(book: BookRow, data: ContactData, actor: number, previous: ContactRow | null) {
  const base = previous ? cardOf(previous) : null;
  const uid = previous?.uid ?? randomUUID();
  const card = applyContact(base, data, uid);
  return storeCard(book, card, { actor, previous });
}

export function createContact(user: UserRow, bookId: string, input: ContactData) {
  const { book } = requireBook(user, bookId, 'write');
  const data = sanitize(input);
  if (!data.name && !data.given && !data.family && !data.organization && !data.emails.length && !data.phones.length && !data.nickname)
    throw badRequest('Gib mindestens einen Namen, eine E-Mail-Adresse oder eine Telefonnummer an');
  const row = tx(() => saveData(book, data, user.id, null));
  announceContacts(bookMembers(book.id));
  return row;
}

export function updateContact(user: UserRow, id: string, input: ContactData, targetBook?: string) {
  const { row, book } = requireContact(user, id, 'write');
  if (row.trashed_at) throw badRequest('Stell den Kontakt zuerst wieder her');
  const data = sanitize(input);
  if (!data.name && !data.given && !data.family && !data.organization && !data.emails.length && !data.phones.length && !data.nickname)
    throw badRequest('Gib mindestens einen Namen, eine E-Mail-Adresse oder eine Telefonnummer an');
  const target = targetBook && targetBook !== book.id ? requireBook(user, targetBook, 'write').book : book;
  const stored = tx(() => {
    if (target.id === book.id) return saveData(book, data, user.id, row);
    if (liveByUid(target.id, row.uid)) throw conflict('Diesen Kontakt gibt es im anderen Adressbuch schon');
    touchBook(book.id, row.href, true);
    const href = hrefFor(target.id, row.uid, row.id);
    run('UPDATE contacts SET book_id = ?, href = ? WHERE id = ?', target.id, href, row.id);
    return saveData(target, data, user.id, { ...row, book_id: target.id, href });
  });
  announceContacts(new Set([...bookMembers(book.id), ...bookMembers(target.id)]));
  return stored;
}

export function moveContacts(user: UserRow, ids: string[], targetBook: string) {
  const target = requireBook(user, targetBook, 'write').book;
  const touched = new Set<string>([target.id]);
  let moved = 0;
  tx(() => {
    for (const id of ids) {
      const { row, book } = requireContact(user, id, 'write');
      if (row.trashed_at || book.id === target.id || liveByUid(target.id, row.uid)) continue;
      touchBook(book.id, row.href, true);
      const href = hrefFor(target.id, row.uid, row.id);
      run(
        'UPDATE contacts SET book_id = ?, href = ?, updated_by = ?, updated_at = ? WHERE id = ?',
        target.id,
        href,
        user.id,
        Date.now(),
        row.id
      );
      touchBook(target.id, href);
      touched.add(book.id);
      moved++;
    }
  });
  announceContacts(new Set([...touched].flatMap((id) => bookMembers(id))));
  return moved;
}

export function trashContact(row: ContactRow, actor: number | null) {
  run('UPDATE contacts SET trashed_at = ?, updated_by = ? WHERE id = ?', Date.now(), actor, row.id);
  touchBook(row.book_id, row.href, true);
}

export function deleteContacts(user: UserRow, ids: string[]) {
  const books = new Set<string>();
  tx(() => {
    for (const id of ids) {
      const { row } = requireContact(user, id, 'write');
      if (row.trashed_at) continue;
      trashContact(row, user.id);
      books.add(row.book_id);
    }
  });
  announceContacts(new Set([...books].flatMap((id) => bookMembers(id))));
  return books.size > 0;
}

export function restoreContact(user: UserRow, id: string) {
  const { row, book } = requireContact(user, id, 'write');
  if (!row.trashed_at) return row;
  if (liveByUid(book.id, row.uid)) throw conflict('Diesen Kontakt gibt es im Adressbuch schon');
  tx(() => {
    run('UPDATE contacts SET trashed_at = NULL, updated_by = ?, updated_at = ? WHERE id = ?', user.id, Date.now(), row.id);
    touchBook(book.id, row.href);
  });
  announceContacts(bookMembers(book.id));
  return getContact(id)!;
}

export function deleteContactForever(user: UserRow, id: string) {
  const { row, book } = requireContact(user, id, 'write');
  tx(() => {
    run('DELETE FROM contacts WHERE id = ?', row.id);
    if (!row.trashed_at) touchBook(book.id, row.href, true);
  });
  announceContacts(bookMembers(book.id));
}

export function emptyContactTrash(user: UserRow) {
  const books = visibleBooks(user).filter((entry) => canAt(entry.access, 'write'));
  if (!books.length) return 0;
  const { changes } = run(
    `DELETE FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NOT NULL`,
    JSON.stringify(books.map((entry) => entry.book.id))
  );
  announceContacts([user.id]);
  return Number(changes);
}

export function purgeContacts(days: number) {
  if (days <= 0) return 0;
  return Number(run('DELETE FROM contacts WHERE trashed_at IS NOT NULL AND trashed_at < ?', Date.now() - days * DAY).changes);
}

export function setFavorite(user: UserRow, id: string, favorite: boolean) {
  requireContact(user, id, 'read');
  if (favorite)
    run('INSERT INTO contact_stars (user_id, contact_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', user.id, id, Date.now());
  else run('DELETE FROM contact_stars WHERE user_id = ? AND contact_id = ?', user.id, id);
  announceContacts([user.id]);
}

export function setLabel(user: UserRow, ids: string[], label: string, add: boolean) {
  const name = label.trim().slice(0, 60);
  if (!name) throw badRequest('Gib einen Namen für das Label ein');
  const books = new Set<string>();
  tx(() => {
    for (const id of ids) {
      const { row, book } = requireContact(user, id, 'write');
      if (row.trashed_at) continue;
      const data = dataOf(row);
      const has = data.categories.some((entry) => entry.toLowerCase() === name.toLowerCase());
      if (has === add) continue;
      data.categories = add ? [...data.categories, name] : data.categories.filter((entry) => entry.toLowerCase() !== name.toLowerCase());
      saveData(book, data, user.id, row);
      books.add(book.id);
    }
  });
  announceContacts(new Set([...books].flatMap((id) => bookMembers(id))));
  return books.size;
}

export function renameLabel(user: UserRow, from: string, to: string | null) {
  const source = from.trim().toLowerCase();
  const target = to?.trim().slice(0, 60) ?? null;
  if (!source) throw badRequest('Dieses Label gibt es nicht');
  const books = visibleBooks(user).filter((entry) => canAt(entry.access, 'write'));
  let changed = 0;
  tx(() => {
    for (const { book } of books) {
      for (const row of all<ContactRow>('SELECT * FROM contacts WHERE book_id = ? AND trashed_at IS NULL', book.id)) {
        const data = dataOf(row);
        if (!data.categories.some((entry) => entry.toLowerCase() === source)) continue;
        const rest = data.categories.filter((entry) => entry.toLowerCase() !== source);
        data.categories = target ? [...new Set([...rest, target])] : rest;
        saveData(book, data, user.id, row);
        changed++;
      }
    }
  });
  if (changed) announceContacts(new Set(books.flatMap((entry) => bookMembers(entry.book.id))));
  return changed;
}

export async function setContactPhoto(user: UserRow, id: string, input: Buffer | null) {
  requireContact(user, id, 'write');
  let jpeg: Buffer | null = null;
  if (input) {
    const sharp = await loadSharp();
    jpeg = await sharp(input, { limitInputPixels: 60_000_000, failOn: 'error' })
      .rotate()
      .resize(512, 512, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer()
      .catch(() => {
        throw badRequest('Dieses Bild kann MoeCloud nicht lesen');
      });
  }
  const { row, book } = requireContact(user, id, 'write');
  const card = cardOf(row);
  setPhoto(card, jpeg);
  const stored = tx(() => storeCard(book, card, { actor: user.id, previous: row }));
  announceContacts(bookMembers(book.id));
  return stored;
}

export function contactPhoto(user: UserRow, id: string) {
  const { row } = requireContact(user, id, 'read');
  const photo = photoOf(cardOf(row));
  if (!photo) throw notFound('Dieser Kontakt hat kein Foto');
  return { ...photo, etag: row.etag };
}

export function birthdaysBetween(user: UserRow, from: string, to: string) {
  const books = visibleBooks(user);
  if (!books.length) return [];
  const rows = all<Pick<ContactRow, 'id' | 'book_id' | 'name' | 'birthday' | 'data' | 'etag'>>(
    `SELECT id, book_id, name, birthday, data, etag FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NULL AND birthday IS NOT NULL AND kind != 'group'`,
    JSON.stringify(books.map((entry) => entry.book.id))
  );
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  const items: { contactId: string; name: string; date: string; year: number | null; age: number | null; photo: string | null }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const birthday = row.birthday!;
    const year = birthday.startsWith('--') ? null : Number(birthday.slice(0, 4));
    const month = birthday.slice(-5, -3);
    const day = birthday.slice(-2);
    const data = dataOf(row);
    const key = `${row.name.toLowerCase()}|${birthday.slice(-5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (let current = first; current <= last; current++) {
      const leap = (current % 4 === 0 && current % 100 !== 0) || current % 400 === 0;
      const date = `${current}-${month}-${month === '02' && day === '29' && !leap ? '28' : day}`;
      if (date < from || date >= to || (year !== null && current < year)) continue;
      items.push({
        contactId: row.id,
        name: data.name,
        date,
        year,
        age: year === null ? null : current - year,
        photo: data.photo ? row.etag : null,
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'de'));
}

export function suggestContacts(user: UserRow, query: string, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const books = visibleBooks(user);
  if (!books.length) return [];
  const rows = all<ContactRow>(
    `SELECT * FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NULL AND kind != 'group' AND search LIKE ? ESCAPE '\\' ORDER BY name LIMIT 60`,
    JSON.stringify(books.map((entry) => entry.book.id)),
    `%${escapeLike(q)}%`
  );
  const out: { contactId: string; name: string; email: string; initials: string; photo: string | null }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const data = dataOf(row);
    for (const entry of data.emails) {
      const email = normalEmail(entry.value);
      if (seen.has(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      if (!data.name.toLowerCase().includes(q) && !email.includes(q) && !data.organization.toLowerCase().includes(q)) continue;
      seen.add(email);
      out.push({
        contactId: row.id,
        name: data.name || email,
        email,
        initials: initials(data.name || email),
        photo: data.photo ? row.etag : null,
      });
    }
  }
  return out
    .sort(
      (a, b) =>
        Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name, 'de')
    )
    .slice(0, limit);
}

export function contactsByEmail(user: UserRow, emails: string[]) {
  const list = [...new Set(emails.map(normalEmail).filter(Boolean))].slice(0, 200);
  if (!list.length) return new Map<string, { id: string; name: string }>();
  const books = visibleBooks(user);
  if (!books.length) return new Map<string, { id: string; name: string }>();
  const rows = all<{ email: string; id: string; name: string }>(
    `SELECT e.email, c.id, c.name FROM contact_emails e JOIN contacts c ON c.id = e.contact_id
     WHERE e.email ${IN_LIST} AND c.book_id ${IN_LIST} AND c.trashed_at IS NULL ORDER BY c.name`,
    JSON.stringify(list),
    JSON.stringify(books.map((entry) => entry.book.id))
  );
  const out = new Map<string, { id: string; name: string }>();
  for (const row of rows) if (!out.has(row.email)) out.set(row.email, { id: row.id, name: row.name });
  return out;
}

const nameKey = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function findDuplicates(user: UserRow) {
  const books = visibleBooks(user).filter((entry) => canAt(entry.access, 'write'));
  if (!books.length) return [];
  const access = new Map(books.map((entry) => [entry.book.id, entry.access]));
  const rows = all<ContactRow>(
    `SELECT * FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NULL AND kind != 'group' ORDER BY created_at`,
    JSON.stringify([...access.keys()])
  );
  const parent = rows.map((_row, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const owners = new Map<string, number>();
  const why = new Map<number, Set<string>>();
  const note = (index: number, reason: string) => {
    let set = why.get(index);
    if (!set) why.set(index, (set = new Set()));
    set.add(reason);
  };
  rows.forEach((row, index) => {
    const data = dataOf(row);
    const keys: [string, string][] = [
      ...data.emails.map((entry): [string, string] => ['email', normalEmail(entry.value)]),
      ...data.phones.map((entry): [string, string] => ['phone', phoneKey(entry.value)]),
      ['name', data.kind === 'org' ? '' : nameKey(data.name)],
    ];
    for (const [reason, raw] of keys) {
      if (!raw || (reason === 'name' && raw.length < 3)) continue;
      const key = `${row.book_id}|${reason}|${raw}`;
      const other = owners.get(key);
      if (other === undefined) {
        owners.set(key, index);
        continue;
      }
      const a = find(other);
      const b = find(index);
      if (a !== b) parent[b] = a;
      note(index, reason);
      note(other, reason);
    }
  });
  const groups = new Map<number, number[]>();
  rows.forEach((_row, index) => {
    const root = find(index);
    const list = groups.get(root);
    if (list) list.push(index);
    else groups.set(root, [index]);
  });
  const stars = starredIds(user);
  return [...groups.values()]
    .filter((members) => members.length > 1)
    .slice(0, 200)
    .map((members) => ({
      reasons: [...new Set(members.flatMap((index) => [...(why.get(index) ?? [])]))],
      items: members.map((index) => summarize(rows[index], access.get(rows[index].book_id)!, stars)),
    }));
}

function mergeEntries<T extends { value: string }>(lists: T[][], key: (entry: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists)
    for (const entry of list) {
      const id = key(entry);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(entry);
    }
  return out;
}

export function mergeContacts(user: UserRow, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length < 2) throw badRequest('Wähle mindestens zwei Kontakte aus');
  if (unique.length > 20) throw badRequest('Du kannst höchstens 20 Kontakte auf einmal zusammenführen');
  const found = unique.map((id) => requireContact(user, id, 'write'));
  const book = found[0].book;
  if (found.some((entry) => entry.book.id !== book.id)) throw badRequest('Die Kontakte müssen im selben Adressbuch liegen');
  if (found.some((entry) => entry.row.trashed_at || entry.row.kind === 'group'))
    throw badRequest('Diese Kontakte lassen sich nicht zusammenführen');
  const datas = found.map((entry) => dataOf(entry.row));
  const merged: ContactData = { ...datas[0] };
  const pick = (field: keyof ContactData) => {
    if (merged[field]) return;
    for (const data of datas.slice(1))
      if (data[field]) {
        (merged as unknown as Record<string, unknown>)[field] = data[field];
        return;
      }
  };
  for (const field of [
    'prefix',
    'given',
    'additional',
    'family',
    'suffix',
    'nickname',
    'organization',
    'department',
    'title',
    'birthday',
    'anniversary',
  ] as const)
    pick(field);
  merged.emails = mergeEntries(
    datas.map((data) => data.emails),
    (entry) => normalEmail(entry.value)
  );
  merged.phones = mergeEntries(
    datas.map((data) => data.phones),
    (entry) => phoneKey(entry.value) || entry.value.trim()
  );
  merged.urls = mergeEntries(
    datas.map((data) => data.urls),
    (entry) => entry.value.trim().toLowerCase().replace(/\/$/, '')
  );
  merged.addresses = mergeEntries(
    datas.map((data) =>
      data.addresses.map((entry) => ({ ...entry, value: [entry.street, entry.code, entry.locality, entry.country].join('|') }))
    ),
    (entry) => entry.value.toLowerCase().replace(/\s+/g, ' ')
  ).map(({ value: _value, ...entry }) => entry);
  merged.categories = [...new Set(datas.flatMap((data) => data.categories))];
  merged.note = [...new Set(datas.map((data) => data.note.trim()).filter(Boolean))].join('\n\n');
  const primary = found[0].row;
  const card = applyContact(cardOf(primary), merged, primary.uid);
  if (!photoOf(card)) {
    const donor = found.slice(1).find((entry) => photoOf(cardOf(entry.row)));
    if (donor) setPhoto(card, photoOf(cardOf(donor.row))!.data);
  }
  const starred = starredIds(user);
  const result = tx(() => {
    const stored = storeCard(book, card, { actor: user.id, previous: primary });
    for (const entry of found.slice(1)) {
      trashContact(entry.row, user.id);
      if (starred.has(entry.row.id))
        run(
          'INSERT INTO contact_stars (user_id, contact_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          user.id,
          primary.id,
          Date.now()
        );
    }
    return stored;
  });
  announceContacts(bookMembers(book.id));
  return result;
}

export function prepareCard(card: VCard) {
  const next = upgradeCard(card);
  ensureName(next);
  return next;
}

export function rowsForExport(user: UserRow, options: { book?: string; ids?: string[] }) {
  const books = new Map(visibleBooks(user).map((entry) => [entry.book.id, entry]));
  if (options.ids?.length) {
    return all<ContactRow>(
      `SELECT * FROM contacts WHERE id ${IN_LIST} AND trashed_at IS NULL`,
      JSON.stringify(options.ids.slice(0, 20000))
    ).filter((row) => books.has(row.book_id));
  }
  const ids = options.book ? (books.has(options.book) ? [options.book] : []) : [...books.keys()];
  if (!ids.length) return [];
  return all<ContactRow>(`SELECT * FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NULL ORDER BY name`, JSON.stringify(ids));
}

export const exportVcf = (rows: Pick<ContactRow, 'vcard'>[]) =>
  rows.map((row) => (row.vcard.endsWith('\n') ? row.vcard : `${row.vcard}\r\n`)).join('');
