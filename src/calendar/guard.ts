import type { FastifyInstance } from 'fastify';
import { all } from '../lib/db.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import * as settings from '../services/settings.ts';
import { ACTIVE, initials, type UserRow } from '../services/users.ts';

export const calendarAllowed = (user: Pick<UserRow, 'role'> | null | undefined) =>
  settings.get('calendar.enabled') && Boolean(user) && user!.role !== 'guest' && user!.role !== 'team';

export function guardCalendar(app: FastifyInstance, open = false) {
  app.addHook('onRequest', async (request) => {
    if (!settings.get('calendar.enabled')) throw notFound();
    if (open) return;
    const role = request.auth?.user.role;
    if (role === 'guest' || role === 'team') throw forbidden('Gastkonten haben keinen Kalender');
  });
}

export function searchPeople(query: string, exclude: number) {
  const q = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  return all<UserRow>(
    `SELECT * FROM users WHERE id != ? AND ${ACTIVE} AND role != 'guest'
       AND (name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR LOWER(email) = ?)
     ORDER BY name COLLATE NOCASE LIMIT 8`,
    exclude,
    Date.now(),
    q,
    q,
    query.trim().toLowerCase()
  ).map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    email: null,
    initials: initials(user.name),
    avatar: user.avatar,
  }));
}
