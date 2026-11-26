import { rm } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError } from '../lib/errors.ts';
import { renderDocument } from '../lib/html.ts';
import { contentDisposition, isSecure } from '../lib/http.ts';
import { t } from '../lib/i18n.ts';
import { body, checkFormCsrf, me } from '../lib/request.ts';
import { intOf, parse } from '../lib/validate.ts';
import {
  copyForm,
  createForm,
  fileLimit,
  formUploads,
  FORM_LIMITS,
  type FormUpload,
  deleteForm,
  deleteResponses,
  formByToken,
  formCsv,
  FormInputError,
  formPatch,
  formResults,
  formState,
  hasAnswered,
  listForms,
  listResponses,
  ownForm,
  presentForm,
  renewToken,
  submitResponse,
  updateForm,
  type FormRow,
} from '../services/forms.ts';
import { receive } from '../services/blobs.ts';
import { formDonePage, formPage } from '../views/forms.ts';
import { messagePage } from '../views/pages.ts';

type IdParams = { Params: { id: string } };
type TokenParams = { Params: { token: string } };

const answeredCookie = (form: Pick<FormRow, 'id'>) => `moe_form_${form.id}`;

async function discard(files: Map<string, FormUpload>) {
  await Promise.all([...files.values()].map((upload) => rm(upload.path, { force: true })));
}

async function readSubmission(request: FastifyRequest, form: FormRow) {
  const files = new Map<string, FormUpload>();
  if (!request.isMultipart()) return { fields: body<Record<string, unknown>>(request), files };
  const questions = new Map(formUploads(form).map((entry) => [`q-${entry.id}`, entry]));
  const fields: Record<string, unknown> = Object.create(null);
  try {
    const options = {
      limits: {
        fields: 1000,
        fieldSize: 64 * 1024,
        files: Math.max(1, Math.min(questions.size, FORM_LIMITS.files)),
        fileSize: Math.max(1, ...[...questions.values()].map(fileLimit)),
        parts: 1100,
      },
      throwFileSizeLimit: false,
    };
    const parts = request.parts(options);
    for await (const part of parts) {
      if (part.type === 'field') {
        if (typeof part.value === 'string' && !(part.fieldname in fields)) fields[part.fieldname] = part.value;
        continue;
      }
      const entry = questions.get(part.fieldname);
      if (!entry || files.has(entry.id) || !part.filename) {
        await finished(part.file.resume());
        continue;
      }
      const received = await receive(part.file);
      files.set(entry.id, { ...received, name: part.filename, truncated: part.file.truncated });
    }
  } catch (error) {
    await discard(files);
    if (error instanceof HttpError) throw error;
    request.log.debug({ error: (error as Error).message }, 'Formularantwort unlesbar');
    throw new HttpError(400, 'Die Antwort kam nicht vollständig an. Versuch es bitte noch einmal.', 'form_body');
  }
  return { fields, files };
}

function closedPage(request: FastifyRequest, reply: FastifyReply, form: FormRow | null) {
  const state = form ? formState(form) : null;
  const ended = state === 'ended' || state === 'full';
  return renderDocument(request, reply, {
    title: form ? form.title : t(request.lang, 'Formular nicht gefunden'),
    status: form ? 410 : 404,
    extraHead: '<meta name="robots" content="noindex">',
    body: messagePage(request, {
      icon: form ? 'eventBusy' : 'linkOff',
      title: form ? t(request.lang, 'Dieses Formular nimmt keine Antworten mehr an') : t(request.lang, 'Dieses Formular gibt es nicht'),
      text: form
        ? ended
          ? t(request.lang, 'Die Frist ist abgelaufen oder es sind genug Antworten da.')
          : t(request.lang, 'Wer es angelegt hat, hat es geschlossen.')
        : t(request.lang, 'Vielleicht hat sich der Link geändert oder das Formular wurde gelöscht.'),
    }),
  });
}

function answeredPage(request: FastifyRequest, reply: FastifyReply, form: FormRow) {
  return renderDocument(request, reply, {
    title: form.title,
    extraHead: '<meta name="robots" content="noindex">',
    body: messagePage(request, {
      icon: 'taskAlt',
      title: t(request.lang, 'Du hast schon geantwortet'),
      text: t(request.lang, 'Bei diesem Formular zählt eine Antwort pro Person. Danke fürs Mitmachen.'),
    }),
  });
}

function loginPage(request: FastifyRequest, reply: FastifyReply, form: FormRow) {
  return renderDocument(request, reply, {
    title: form.title,
    status: 401,
    extraHead: '<meta name="robots" content="noindex">',
    body: messagePage(request, {
      icon: 'login',
      title: form.title,
      text: t(request.lang, 'Dieses Formular können nur angemeldete Personen ausfüllen.'),
      action: { label: t(request.lang, 'Anmelden'), href: `/login?next=${encodeURIComponent(`/f/${form.token}`)}` },
    }),
  });
}

function showForm(
  request: FastifyRequest,
  reply: FastifyReply,
  form: FormRow,
  extra: { values?: Record<string, unknown>; errors?: Record<string, string>; error?: string | null; status?: number } = {}
) {
  const user = request.auth?.session ? request.auth.user : null;
  return renderDocument(request, reply, {
    title: form.title,
    status: extra.status,
    extraHead: '<meta name="robots" content="noindex">\n<meta name="referrer" content="no-referrer">',
    body: formPage(request, {
      form,
      csrf: request.auth?.session?.csrf ?? request.csrf,
      values: extra.values ?? {},
      errors: extra.errors ?? {},
      error: extra.error,
      person: user && form.named ? user.name : null,
    }),
  });
}

export async function formRoutes(app: FastifyInstance) {
  app.get('/api/forms', async (request) => ({ items: listForms(me(request)) }));

  app.post('/api/forms', async (request) => {
    const input = parse(z.object({ title: z.string().trim().min(1, 'Gib dem Formular einen Titel').max(200) }), request.body);
    return { form: presentForm(createForm(me(request), input.title, request.lang)) };
  });

  app.get<IdParams>('/api/forms/:id', async (request) => ({ form: presentForm(ownForm(me(request), request.params.id)) }));

  app.patch<IdParams>('/api/forms/:id', async (request) => {
    const input = parse(formPatch, request.body);
    return { form: presentForm(updateForm(me(request), request.params.id, input)) };
  });

  app.delete<IdParams>('/api/forms/:id', async (request) => {
    deleteForm(me(request), request.params.id);
    return { ok: true };
  });

  app.post<IdParams>('/api/forms/:id/copy', async (request) => ({
    form: presentForm(copyForm(me(request), request.params.id, request.lang)),
  }));

  app.post<IdParams>('/api/forms/:id/token', async (request) => ({ form: presentForm(renewToken(me(request), request.params.id)) }));

  app.get<IdParams>('/api/forms/:id/results', async (request) => formResults(me(request), request.params.id));

  app.get<IdParams & { Querystring: { offset?: string; limit?: string } }>('/api/forms/:id/responses', async (request) => {
    const offset = Math.max(0, intOf(request.query.offset ?? '0') || 0);
    const limit = Math.min(100, Math.max(1, intOf(request.query.limit ?? '20') || 20));
    return listResponses(me(request), request.params.id, offset, limit);
  });

  app.delete<IdParams>('/api/forms/:id/responses', async (request) => ({
    removed: deleteResponses(me(request), request.params.id, null),
  }));

  app.delete<{ Params: { id: string; response: string } }>('/api/forms/:id/responses/:response', async (request) => ({
    removed: deleteResponses(me(request), request.params.id, request.params.response),
  }));

  app.get<IdParams>('/api/forms/:id/export', async (request, reply) => {
    const csv = formCsv(me(request), request.params.id, request.lang);
    const name = `${csv.form.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Formular'}.csv`;
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', contentDisposition(name, 'attachment')).send(csv.text);
  });

  app.get<TokenParams & { Querystring: { gesendet?: string } }>('/f/:token', async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const form = formByToken(request.params.token);
    if (!form) return closedPage(request, reply, null);
    const user = request.auth?.session ? request.auth.user : null;
    if (request.query.gesendet !== undefined) {
      return renderDocument(request, reply, {
        title: form.title,
        extraHead: '<meta name="robots" content="noindex">',
        body: formDonePage(request, { form, again: !form.once && formState(form) === 'open', token: form.token }),
      });
    }
    if (formState(form) !== 'open') return closedPage(request, reply, form);
    if (form.signed_in && !user) return loginPage(request, reply, form);
    if (form.once && (user && form.signed_in ? hasAnswered(form, user) : request.cookies?.[answeredCookie(form)] === '1')) {
      return answeredPage(request, reply, form);
    }
    return showForm(request, reply, form);
  });

  app.post<TokenParams>('/f/:token', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    reply.header('Referrer-Policy', 'no-referrer');
    const form = formByToken(request.params.token);
    if (!form) return closedPage(request, reply, null);
    let fields: Record<string, unknown> = {};
    let files = new Map<string, FormUpload>();
    const user = request.auth?.session ? request.auth.user : null;
    const done = () => reply.redirect(`/f/${form.token}?gesendet`, 303);
    try {
      ({ fields, files } = await readSubmission(request, form));
      checkFormCsrf(request, fields._csrf);
      if (typeof fields.website === 'string' && fields.website.trim()) return done();
      if (form.signed_in && !user) return loginPage(request, reply, form);
      if (form.once && !form.signed_in && request.cookies?.[answeredCookie(form)] === '1') return answeredPage(request, reply, form);
      await submitResponse(form, user, fields, request.lang, files);
    } catch (error) {
      if (error instanceof FormInputError) return showForm(request, reply, form, { values: fields, errors: error.errors, status: 400 });
      if (!(error instanceof HttpError)) throw error;
      if (error.code === 'answered') return answeredPage(request, reply, form);
      if (error.status === 410) return closedPage(request, reply, form);
      return showForm(request, reply, form, {
        values: fields,
        error: t(request.lang, error.message, error.params),
        status: error.status,
      });
    } finally {
      await discard(files);
    }
    if (form.once && !form.signed_in) {
      reply.setCookie(answeredCookie(form), '1', {
        path: `/f/`,
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecure(request),
        maxAge: 365 * 86_400,
      });
    }
    return done();
  });
}
