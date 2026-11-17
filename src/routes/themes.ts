import type { FastifyInstance } from 'fastify';
import type { Lang } from '../lib/i18n.ts';
import { admin, me } from '../lib/request.ts';
import { parse } from '../lib/validate.ts';
import { audit } from '../services/audit.ts';
import {
  adminThemes,
  choiceSchema,
  createTheme,
  deleteTheme,
  effectiveTheme,
  exportTheme,
  listThemes,
  setSiteTheme,
  setUserTheme,
  themeBoot,
  themeSchema,
  updateTheme,
} from '../services/themes.ts';
import { getUser, type UserRow } from '../services/users.ts';

type IdParams = { Params: { id: string } };

function mine(user: UserRow, lang: Lang) {
  const fresh = getUser(user.id) ?? user;
  const theme = effectiveTheme(fresh, lang);
  return { theme: themeBoot(theme), palette: theme.palette, css: theme.css, ...listThemes(fresh, lang) };
}

export async function themeRoutes(app: FastifyInstance) {
  app.get('/api/themes', async (request) => listThemes(me(request), request.lang));

  app.put('/api/account/theme', async (request) => {
    const user = me(request);
    setUserTheme(user, parse(choiceSchema, request.body));
    return mine(user, request.lang);
  });

  app.get('/api/admin/themes', async (request) => {
    admin(request);
    return { items: adminThemes() };
  });

  app.post('/api/admin/themes', async (request, reply) => {
    const actor = admin(request);
    const theme = createTheme(parse(themeSchema, request.body));
    audit('theme_saved', { actor: actor.id, request, details: { name: theme.name } });
    return reply.code(201).send({ id: theme.id, ...mine(actor, request.lang), items: adminThemes() });
  });

  app.put<IdParams>('/api/admin/themes/:id', async (request) => {
    const actor = admin(request);
    const theme = updateTheme(request.params.id, parse(themeSchema, request.body));
    audit('theme_saved', { actor: actor.id, request, details: { name: theme.name } });
    return { id: theme.id, ...mine(actor, request.lang), items: adminThemes() };
  });

  app.delete<IdParams>('/api/admin/themes/:id', async (request) => {
    const actor = admin(request);
    const name = adminThemes().find((theme) => theme.id === request.params.id)?.name;
    deleteTheme(request.params.id);
    audit('theme_deleted', { actor: actor.id, request, details: { name: name ?? request.params.id } });
    return { ...mine(actor, request.lang), items: adminThemes() };
  });

  app.get<IdParams>('/api/admin/themes/:id/export', async (request, reply) => {
    admin(request);
    const theme = exportTheme(request.params.id);
    const file = `${theme.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'theme'}.moetheme.json`;
    return reply
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file)}`)
      .type('application/json; charset=utf-8')
      .send(`${JSON.stringify(theme, null, 2)}\n`);
  });

  app.put('/api/admin/site-theme', async (request) => {
    const actor = admin(request);
    setSiteTheme(parse(choiceSchema, request.body));
    audit('settings_changed', { actor: actor.id, request, details: { keys: ['theme.site'] } });
    return mine(actor, request.lang);
  });
}
