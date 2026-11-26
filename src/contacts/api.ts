import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { me } from '../lib/request.ts';
import { intOf, parse } from '../lib/validate.ts';
import * as settings from '../services/settings.ts';
import {
  contactsAllowed,
  deleteBook,
  insertBook,
  listBooks,
  listBookShares,
  presentBook,
  removeBookShare,
  reorderBooks,
  requireBook,
  setBookShare,
  updateBook,
} from './books.ts';
import {
  birthdaysBetween,
  contactPhoto,
  createContact,
  deleteContactForever,
  deleteContacts,
  emptyContactTrash,
  exportVcf,
  findDuplicates,
  listContacts,
  listLabels,
  mergeContacts,
  moveContacts,
  presentContact,
  renameLabel,
  requireContact,
  restoreContact,
  rowsForExport,
  setContactPhoto,
  setFavorite,
  setLabel,
  starredIds,
  suggestContacts,
  updateContact,
} from './store.ts';
import {
  CONTACT_LIMITS,
  ContactImportError,
  discardContactImport,
  exportContactsCsv,
  presentContactImport,
  runContactImport,
  startContactImport,
  startContactNodeImport,
  getContactImport,
} from './transfer.ts';
import type { ContactData } from './vcard.ts';

const entry = z.object({
  type: z.enum(['home', 'work', 'mobile', 'main', 'fax', 'pager', 'other']),
  value: z.string().max(2000),
  label: z.string().max(60).nullable().optional(),
});

const address = z.object({
  type: z.enum(['home', 'work', 'mobile', 'main', 'fax', 'pager', 'other']),
  label: z.string().max(60).nullable().optional(),
  street: z.string().max(300),
  locality: z.string().max(120),
  region: z.string().max(120),
  code: z.string().max(30),
  country: z.string().max(120),
  pobox: z.string().max(60).optional(),
  extended: z.string().max(200).optional(),
});

const date = z
  .string()
  .regex(/^(\d{4}|-)-\d{2}-\d{2}$/, 'Das Datum sieht nicht richtig aus')
  .nullable();

const contactSchema = z.object({
  kind: z.enum(['individual', 'org']).default('individual'),
  name: z.string().max(300).default(''),
  prefix: z.string().max(60).default(''),
  given: z.string().max(120).default(''),
  additional: z.string().max(120).default(''),
  family: z.string().max(120).default(''),
  suffix: z.string().max(60).default(''),
  nickname: z.string().max(120).default(''),
  organization: z.string().max(200).default(''),
  department: z.string().max(200).default(''),
  title: z.string().max(200).default(''),
  emails: z.array(entry).max(50).default([]),
  phones: z.array(entry).max(50).default([]),
  addresses: z.array(address).max(50).default([]),
  urls: z.array(entry).max(50).default([]),
  birthday: date.default(null),
  anniversary: date.default(null),
  note: z.string().max(20_000).default(''),
  categories: z.array(z.string().max(60)).max(50).default([]),
});

const toData = (input: z.infer<typeof contactSchema>): ContactData => ({
  ...input,
  emails: input.emails.map((item) => ({ ...item, label: item.label ?? null })),
  phones: input.phones.map((item) => ({ ...item, label: item.label ?? null })),
  urls: input.urls.map((item) => ({ ...item, label: item.label ?? null })),
  addresses: input.addresses.map((item) => ({
    ...item,
    label: item.label ?? null,
    pobox: item.pobox ?? '',
    extended: item.extended ?? '',
  })),
  members: [],
  photo: false,
});

const idList = z.array(z.string().min(1).max(40)).min(1, 'Wähle mindestens einen Kontakt aus').max(5000);

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Das Datum sieht nicht richtig aus');

function rethrow(error: unknown): never {
  if (error instanceof ContactImportError) throw badRequest(error.message, error.params);
  throw error;
}

const flag = (value: unknown) => value === '1' || value === 'true';

function fileName(name: string, extension: string) {
  return `${name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Kontakte'}.${extension}`;
}

export async function contactRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!settings.get('contacts.enabled')) throw notFound();
    const user = request.auth?.user;
    if (user && !contactsAllowed(user)) throw forbidden('Gastkonten haben keine Kontakte');
  });

  app.get('/api/contacts/books', async (request) => ({ books: listBooks(me(request)) }));

  app.post('/api/contacts/books', async (request) => {
    const input = parse(
      z.object({ name: z.string().trim().min(1, 'Gib einen Namen ein').max(100), description: z.string().max(2000).optional() }),
      request.body
    );
    const book = insertBook(me(request), input);
    return { book: presentBook(book, 'owner') };
  });

  app.patch<{ Params: { id: string } }>('/api/contacts/books/:id', async (request) => {
    const input = parse(
      z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().max(2000).nullable().optional() }),
      request.body
    );
    const book = updateBook(me(request), request.params.id, input);
    return { book: presentBook(book, 'owner') };
  });

  app.delete<{ Params: { id: string } }>('/api/contacts/books/:id', async (request) => deleteBook(me(request), request.params.id));

  app.put('/api/contacts/books/order', async (request) => {
    const input = parse(z.object({ ids: z.array(z.string().max(40)).max(200) }), request.body);
    reorderBooks(me(request), input.ids);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/contacts/books/:id/shares', async (request) => ({
    shares: listBookShares(me(request), request.params.id),
  }));

  app.put<{ Params: { id: string; user: string } }>('/api/contacts/books/:id/shares/:user', async (request) => {
    const input = parse(z.object({ permission: z.enum(['read', 'write']) }), request.body);
    setBookShare(me(request), request.params.id, intOf(request.params.user), input.permission);
    return { ok: true };
  });

  app.delete<{ Params: { id: string; user: string } }>('/api/contacts/books/:id/shares/:user', async (request) => {
    removeBookShare(me(request), request.params.id, intOf(request.params.user));
    return { ok: true };
  });

  app.get<{ Querystring: { book?: string; q?: string; label?: string; group?: string; favorites?: string; trash?: string } }>(
    '/api/contacts',
    async (request) => {
      const user = me(request);
      const query = request.query;
      return {
        items: listContacts(user, {
          book: query.book?.slice(0, 40) || undefined,
          q: query.q?.slice(0, 120) || undefined,
          label: query.label?.slice(0, 60) || undefined,
          group: query.group?.slice(0, 40) || undefined,
          favorites: flag(query.favorites),
          trash: flag(query.trash),
        }),
        trashDays: settings.get('calendar.trashDays'),
      };
    }
  );

  app.get('/api/contacts/labels', async (request) => listLabels(me(request)));

  app.post('/api/contacts/labels', async (request) => {
    const input = parse(z.object({ ids: idList, label: z.string().trim().min(1).max(60), add: z.boolean().default(true) }), request.body);
    return { changed: setLabel(me(request), input.ids, input.label, input.add) };
  });

  app.patch('/api/contacts/labels', async (request) => {
    const input = parse(z.object({ from: z.string().trim().min(1).max(60), to: z.string().trim().max(60).nullable() }), request.body);
    return { changed: renameLabel(me(request), input.from, input.to || null) };
  });

  app.get<{ Querystring: { q?: string } }>('/api/contacts/suggest', async (request) => ({
    items: suggestContacts(me(request), String(request.query.q ?? '').slice(0, 80)),
  }));

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/contacts/birthdays', async (request) => {
    const input = parse(z.object({ from: dayKey, to: dayKey }), request.query);
    if (input.to <= input.from) throw badRequest('Der Zeitraum ist ungültig');
    if (Date.parse(input.to) - Date.parse(input.from) > 400 * 86_400_000) throw badRequest('Der Zeitraum ist zu lang');
    return { items: birthdaysBetween(me(request), input.from, input.to) };
  });

  app.get('/api/contacts/duplicates', async (request) => ({ groups: findDuplicates(me(request)) }));

  app.post('/api/contacts/merge', async (request) => {
    const input = parse(z.object({ ids: idList.max(20) }), request.body);
    const user = me(request);
    const row = mergeContacts(user, input.ids);
    return { contact: presentContact(user, row, requireContact(user, row.id).access) };
  });

  app.post('/api/contacts/move', async (request) => {
    const input = parse(z.object({ ids: idList, book: z.string().min(1).max(40) }), request.body);
    return { moved: moveContacts(me(request), input.ids, input.book) };
  });

  app.post('/api/contacts/delete', async (request) => {
    const input = parse(z.object({ ids: idList }), request.body);
    deleteContacts(me(request), input.ids);
    return { trashed: true, days: settings.get('calendar.trashDays') };
  });

  app.delete('/api/contacts/trash', async (request) => ({ deleted: emptyContactTrash(me(request)) }));

  app.post('/api/contacts', async (request) => {
    const input = parse(z.object({ bookId: z.string().min(1).max(40), data: contactSchema }), request.body);
    const user = me(request);
    const row = createContact(user, input.bookId, toData(input.data));
    return { contact: presentContact(user, row, requireContact(user, row.id).access) };
  });

  app.post('/api/contacts/import', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    const user = me(request);
    try {
      if (request.isMultipart()) {
        const files: { name: string; data: Buffer }[] = [];
        const parts = request.parts({ limits: { files: CONTACT_LIMITS.files, fileSize: CONTACT_LIMITS.bytes, fields: 5, parts: 60 } });
        for await (const part of parts) {
          if (part.type !== 'file') continue;
          files.push({ name: (part.filename || 'kontakte.vcf').slice(0, 255), data: await part.toBuffer() });
        }
        return { job: await startContactImport(user, files) };
      }
      const input = parse(z.object({ node: z.string().min(1).max(40) }), request.body);
      return { job: await startContactNodeImport(user, input.node) };
    } catch (error) {
      rethrow(error);
    }
  });

  app.get<{ Params: { id: string } }>('/api/contacts/import/:id', async (request) => ({
    job: presentContactImport(getContactImport(me(request), request.params.id)),
  }));

  app.post<{ Params: { id: string } }>('/api/contacts/import/:id/run', async (request) => {
    const input = parse(
      z.object({
        book: z.string().min(1).max(40),
        name: z.string().trim().max(100).optional(),
        mode: z.enum(['merge', 'skip', 'copy']).default('merge'),
      }),
      request.body
    );
    return runContactImport(me(request), request.params.id, { book: input.book, name: input.name }, input.mode);
  });

  app.delete<{ Params: { id: string } }>('/api/contacts/import/:id', async (request) => {
    discardContactImport(me(request), request.params.id);
    return { ok: true };
  });

  app.get<{ Querystring: { book?: string; ids?: string; format?: string } }>('/api/contacts/export', async (request, reply) => {
    const user = me(request);
    const ids = request.query.ids ? request.query.ids.split(',').filter(Boolean).slice(0, 5000) : undefined;
    const book = request.query.book ? requireBook(user, request.query.book).book : null;
    const rows = rowsForExport(user, { book: book?.id, ids });
    const base = book?.name ?? (ids?.length === 1 && rows[0] ? rows[0].name : 'Kontakte');
    if (request.query.format === 'csv') {
      return reply
        .type('text/csv; charset=utf-8')
        .header('Content-Disposition', contentDisposition(fileName(base, 'csv'), 'attachment'))
        .send(exportContactsCsv(rows, starredIds(user)));
    }
    return reply
      .type('text/vcard; charset=utf-8')
      .header('Content-Disposition', contentDisposition(fileName(base, 'vcf'), 'attachment'))
      .send(exportVcf(rows));
  });

  app.get<{ Params: { id: string } }>('/api/contacts/:id', async (request) => {
    const user = me(request);
    const { row, access } = requireContact(user, request.params.id);
    return { contact: presentContact(user, row, access) };
  });

  app.put<{ Params: { id: string } }>('/api/contacts/:id', async (request) => {
    const input = parse(z.object({ data: contactSchema, bookId: z.string().min(1).max(40).optional() }), request.body);
    const user = me(request);
    const row = updateContact(user, request.params.id, toData(input.data), input.bookId);
    return { contact: presentContact(user, row, requireContact(user, row.id).access) };
  });

  app.post<{ Params: { id: string } }>('/api/contacts/:id/favorite', async (request) => {
    const input = parse(z.object({ favorite: z.boolean() }), request.body);
    setFavorite(me(request), request.params.id, input.favorite);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/contacts/:id', async (request) => {
    deleteContacts(me(request), [request.params.id]);
    return { trashed: true, days: settings.get('calendar.trashDays') };
  });

  app.post<{ Params: { id: string } }>('/api/contacts/:id/restore', async (request) => {
    const user = me(request);
    const row = restoreContact(user, request.params.id);
    return { contact: presentContact(user, row, requireContact(user, row.id).access) };
  });

  app.delete<{ Params: { id: string } }>('/api/contacts/:id/forever', async (request) => {
    deleteContactForever(me(request), request.params.id);
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/contacts/:id/photo', async (request, reply) => {
    const photo = contactPhoto(me(request), request.params.id);
    if (request.headers['if-none-match'] === `"${photo.etag}"`) return reply.code(304).send();
    return reply
      .type(photo.type)
      .header('Cache-Control', 'private, max-age=86400')
      .header('ETag', `"${photo.etag}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .send(photo.data);
  });

  app.put<{ Params: { id: string } }>(
    '/api/contacts/:id/photo',
    { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (request) => {
      const user = me(request);
      if (!request.isMultipart()) throw badRequest('Wähle ein Bild aus');
      const part = await request.file({ limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
      if (!part) throw badRequest('Wähle ein Bild aus');
      const data = await part.toBuffer();
      if (part.file.truncated) throw badRequest('Das Bild ist zu groß');
      const row = await setContactPhoto(user, request.params.id, data);
      return { contact: presentContact(user, row, requireContact(user, row.id).access) };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/contacts/:id/photo', async (request) => {
    const user = me(request);
    const row = await setContactPhoto(user, request.params.id, null);
    return { contact: presentContact(user, row, requireContact(user, row.id).access) };
  });

  app.get<{ Params: { id: string } }>('/api/contacts/:id/vcard', async (request, reply) => {
    const { row } = requireContact(me(request), request.params.id);
    return reply
      .type('text/vcard; charset=utf-8')
      .header('Content-Disposition', contentDisposition(fileName(row.name, 'vcf'), 'attachment'))
      .send(row.vcard);
  });
}
