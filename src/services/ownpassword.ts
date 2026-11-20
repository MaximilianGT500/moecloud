import type { FastifyReply, FastifyRequest } from 'fastify';
import { hashPassword, verifyPassword } from '../lib/crypto.ts';
import { run } from '../lib/db.ts';
import { badRequest } from '../lib/errors.ts';
import { audit } from './audit.ts';
import { forgetOtherDevices } from './devices.ts';
import { notify } from './notify.ts';
import { checkPassword } from './passwords.ts';
import { destroyUserSessions } from './sessions.ts';
import type { UserRow } from './users.ts';

export async function changeOwnPassword(request: FastifyRequest, reply: FastifyReply, user: UserRow, current: string, next: string) {
  if (user.password_hash && !(await verifyPassword(user.password_hash, current))) throw badRequest('Das aktuelle Passwort stimmt nicht');
  await checkPassword(next);
  if (user.must_change && user.password_hash && (await verifyPassword(user.password_hash, next)))
    throw badRequest('Das neue Passwort muss sich vom alten unterscheiden');
  run('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?', await hashPassword(next), user.id);
  destroyUserSessions(user.id, request.auth?.session?.id);
  forgetOtherDevices(request, reply, user);
  audit('password_changed', { actor: user.id, request });
  notify(user.id, 'account_change', { change: 'password' }, '/account#sitzungen');
}
