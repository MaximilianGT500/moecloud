import { all, IN_LIST, one, run, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { notify } from '../services/notify.ts';
import * as settings from '../services/settings.ts';
import { getUser, inactive, initials, preferredLanguage, type UserRow } from '../services/users.ts';

export interface BookRow {
  id: string;
  owner_id: number;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  revision: number;
  created_at: number;
  updated_at: number;
}

export type BookAccess = 'owner' | 'write' | 'read';

const RANK: Record<BookAccess, number> = { read: 1, write: 2, owner: 3 };

export const contactsAllowed = (user: Pick<UserRow, 'role'> | null | undefined) =>
  settings.get('contacts.enabled') && Boolean(user) && user!.role !== 'guest' && user!.role !== 'team';

export const canAt = (access: BookAccess | null | undefined, level: BookAccess) => Boolean(access) && RANK[access!] >= RANK[level];

export function announceContacts(userIds: Iterable<number>) {
  publish(new Set(userIds), 'contacts', { at: Date.now() });
}

export const getBook = (id: string) => one<BookRow>('SELECT * FROM address_books WHERE id = ?', id);

export function bookMembers(bookId: string) {
  const book = getBook(bookId);
  if (!book) return [];
  return [
    book.owner_id,
    ...all<{ user_id: number }>('SELECT user_id FROM address_book_shares WHERE book_id = ?', bookId).map((row) => row.user_id),
  ];
}

export function touchBook(bookId: string, href: string | null, deleted = false) {
  run('UPDATE address_books SET revision = revision + 1, updated_at = ? WHERE id = ?', Date.now(), bookId);
  if (!href) return;
  const revision = value<number>('SELECT revision FROM address_books WHERE id = ?', bookId) ?? 1;
  run(
    `INSERT INTO contact_changes (book_id, href, revision, deleted) VALUES (?, ?, ?, ?)
     ON CONFLICT (book_id, href) DO UPDATE SET revision = excluded.revision, deleted = excluded.deleted`,
    bookId,
    href,
    revision,
    deleted ? 1 : 0
  );
}

export function bookAccess(user: Pick<UserRow, 'id'>, book: BookRow): BookAccess | null {
  if (book.owner_id === user.id) return 'owner';
  const share = one<{ permission: string }>(
    'SELECT permission FROM address_book_shares WHERE book_id = ? AND user_id = ?',
    book.id,
    user.id
  );
  if (!share) return null;
  const owner = getUser(book.owner_id);
  if (!owner || inactive(owner)) return null;
  return share.permission === 'write' ? 'write' : 'read';
}

export function requireBook(user: Pick<UserRow, 'id'>, id: string, level: BookAccess = 'read') {
  const book = getBook(id);
  const access = book ? bookAccess(user, book) : null;
  if (!book || !access) throw notFound('Dieses Adressbuch gibt es nicht');
  if (!canAt(access, level))
    throw forbidden(level === 'owner' ? 'Das darf nur die Person, der das Adressbuch gehört' : 'In diesem Adressbuch darfst du nur lesen');
  return { book, access };
}

export function insertBook(owner: Pick<UserRow, 'id'>, input: { name: string; description?: string | null; slug?: string }) {
  const id = randomId(16);
  const slug = input.slug ?? id;
  if (one('SELECT 1 FROM address_books WHERE owner_id = ? AND slug = ?', owner.id, slug)) throw conflict('Dieses Adressbuch gibt es schon');
  const now = Date.now();
  const position = (value<number>('SELECT MAX(position) FROM address_books WHERE owner_id = ?', owner.id) ?? -1) + 1;
  run(
    'INSERT INTO address_books (id, owner_id, slug, name, description, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    owner.id,
    slug,
    input.name.trim().slice(0, 100) || 'Kontakte',
    input.description?.trim().slice(0, 2000) || null,
    position,
    now,
    now
  );
  announceContacts([owner.id]);
  return getBook(id)!;
}

export function ensureBooks(user: UserRow) {
  if (value<number>('SELECT 1 FROM address_books WHERE owner_id = ? LIMIT 1', user.id)) return;
  try {
    insertBook(user, { name: preferredLanguage(user) === 'en' ? 'Contacts' : 'Kontakte', slug: 'contacts' });
  } catch (error) {
    if (!(error instanceof HttpError) || !value<number>('SELECT 1 FROM address_books WHERE owner_id = ? LIMIT 1', user.id)) throw error;
  }
}

export const ownBooks = (userId: number) =>
  all<BookRow>('SELECT * FROM address_books WHERE owner_id = ? ORDER BY position, created_at', userId);

export function visibleBooks(user: UserRow) {
  ensureBooks(user);
  const own = ownBooks(user.id).map((book) => ({ book, access: 'owner' as BookAccess }));
  const shared = all<BookRow & { permission: string }>(
    `SELECT b.*, s.permission FROM address_books b JOIN address_book_shares s ON s.book_id = b.id
     WHERE s.user_id = ? ORDER BY b.name, b.id`,
    user.id
  )
    .filter((row) => {
      const owner = getUser(row.owner_id);
      return owner && !inactive(owner);
    })
    .map(({ permission, ...book }) => ({ book: book as BookRow, access: (permission === 'write' ? 'write' : 'read') as BookAccess }));
  return [...own, ...shared];
}

export function presentBook(book: BookRow, access: BookAccess, count = 0, shares = 0) {
  const owner = access === 'owner' ? null : getUser(book.owner_id);
  return {
    id: book.id,
    name: book.name,
    description: book.description ?? '',
    access,
    count,
    shares,
    owner: owner ? { id: owner.id, name: owner.name, initials: initials(owner.name) } : null,
  };
}

export function listBooks(user: UserRow) {
  const books = visibleBooks(user);
  if (!books.length) return [];
  const ids = JSON.stringify(books.map((entry) => entry.book.id));
  const counts = new Map(
    all<{ book_id: string; count: number }>(
      `SELECT book_id, COUNT(*) AS count FROM contacts WHERE book_id ${IN_LIST} AND trashed_at IS NULL AND kind != 'group' GROUP BY book_id`,
      ids
    ).map((row) => [row.book_id, Number(row.count)])
  );
  const shares = new Map(
    all<{ book_id: string; count: number }>(
      `SELECT book_id, COUNT(*) AS count FROM address_book_shares WHERE book_id ${IN_LIST} GROUP BY book_id`,
      ids
    ).map((row) => [row.book_id, Number(row.count)])
  );
  return books.map(({ book, access }) =>
    presentBook(book, access, counts.get(book.id) ?? 0, access === 'owner' ? (shares.get(book.id) ?? 0) : 0)
  );
}

export function updateBook(user: UserRow, id: string, patch: { name?: string; description?: string | null }) {
  const { book } = requireBook(user, id, 'owner');
  const name = patch.name === undefined ? book.name : patch.name.trim().slice(0, 100) || book.name;
  const description = patch.description === undefined ? book.description : patch.description?.trim().slice(0, 2000) || null;
  run('UPDATE address_books SET name = ?, description = ? WHERE id = ?', name, description, id);
  touchBook(id, null);
  announceContacts(bookMembers(id));
  return getBook(id)!;
}

export function deleteBook(user: UserRow, id: string) {
  const { book, access } = requireBook(user, id, 'read');
  if (access !== 'owner') {
    run('DELETE FROM address_book_shares WHERE book_id = ? AND user_id = ?', id, user.id);
    announceContacts([user.id, book.owner_id]);
    return { left: true };
  }
  if ((value<number>('SELECT COUNT(*) FROM address_books WHERE owner_id = ?', user.id) ?? 0) <= 1)
    throw badRequest('Dein letztes Adressbuch kannst du nicht löschen');
  const members = bookMembers(id);
  run('DELETE FROM address_books WHERE id = ?', id);
  announceContacts(members);
  return { left: false };
}

export function reorderBooks(user: UserRow, ids: string[]) {
  const own = new Set(ownBooks(user.id).map((book) => book.id));
  ids
    .filter((id) => own.has(id))
    .forEach((id, index) => run('UPDATE address_books SET position = ? WHERE id = ? AND owner_id = ?', index, id, user.id));
  announceContacts([user.id]);
}

export function listBookShares(user: UserRow, id: string) {
  requireBook(user, id, 'owner');
  return all<{ user_id: number; permission: string; created_at: number }>(
    'SELECT user_id, permission, created_at FROM address_book_shares WHERE book_id = ? ORDER BY created_at',
    id
  ).flatMap((row) => {
    const person = getUser(row.user_id);
    if (!person) return [];
    return [
      {
        user: {
          id: person.id,
          username: person.username,
          name: person.name,
          initials: initials(person.name),
          avatar: person.avatar ?? null,
        },
        permission: row.permission === 'write' ? 'write' : 'read',
      },
    ];
  });
}

export function setBookShare(user: UserRow, id: string, targetId: number, permission: 'read' | 'write') {
  const { book } = requireBook(user, id, 'owner');
  if (targetId === user.id) throw badRequest('Mit dir selbst musst du nichts teilen');
  const target = getUser(targetId);
  if (!target || inactive(target) || !contactsAllowed(target)) throw notFound('Diese Person gibt es nicht');
  const existing = one('SELECT 1 FROM address_book_shares WHERE book_id = ? AND user_id = ?', id, targetId);
  if (existing) run('UPDATE address_book_shares SET permission = ? WHERE book_id = ? AND user_id = ?', permission, id, targetId);
  else
    run(
      'INSERT INTO address_book_shares (book_id, user_id, permission, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      targetId,
      permission,
      user.id,
      Date.now()
    );
  touchBook(id, null);
  announceContacts([user.id, targetId]);
  if (!existing) notify(targetId, 'contacts_shared', { by: user.name, name: book.name, permission }, '/contacts');
  return { created: !existing };
}

export function removeBookShare(user: UserRow, id: string, targetId: number) {
  const book = getBook(id);
  if (!book) throw notFound('Dieses Adressbuch gibt es nicht');
  if (book.owner_id !== user.id && targetId !== user.id) throw forbidden();
  run('DELETE FROM address_book_shares WHERE book_id = ? AND user_id = ?', id, targetId);
  touchBook(id, null);
  announceContacts([book.owner_id, targetId]);
}

export function transferBooks(fromId: number, toId: number, label: string) {
  const list = all<BookRow>('SELECT * FROM address_books WHERE owner_id = ?', fromId);
  let position = (value<number>('SELECT MAX(position) FROM address_books WHERE owner_id = ?', toId) ?? -1) + 1;
  const now = Date.now();
  for (const book of list) {
    let slug = book.slug;
    for (let index = 2; one('SELECT 1 FROM address_books WHERE owner_id = ? AND slug = ?', toId, slug); index++)
      slug = `${book.slug}-${index}`;
    run(
      'UPDATE address_books SET owner_id = ?, slug = ?, name = ?, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
      toId,
      slug,
      `${book.name} (${label})`.slice(0, 100),
      position++,
      now,
      book.id
    );
    run('DELETE FROM address_book_shares WHERE book_id = ? AND user_id = ?', book.id, toId);
  }
  if (list.length) announceContacts([toId]);
  return list.length;
}

export function contactStats() {
  return {
    books: value<number>('SELECT COUNT(*) FROM address_books') ?? 0,
    contacts: value<number>("SELECT COUNT(*) FROM contacts WHERE trashed_at IS NULL AND kind != 'group'") ?? 0,
    shares: value<number>('SELECT COUNT(*) FROM address_book_shares') ?? 0,
  };
}
