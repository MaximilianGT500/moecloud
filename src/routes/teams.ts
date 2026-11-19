import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../lib/errors.ts';
import { admin, me } from '../lib/request.ts';
import { ids, parse } from '../lib/validate.ts';
import {
  candidates,
  createTeam,
  deleteTeam,
  destroyInTeam,
  emptyTeamTrash,
  leaveTeam,
  listTeams,
  presentTeam,
  removeGroup,
  removePerson,
  requireTeam,
  restoreInTeam,
  roleIn,
  setGroup,
  setPerson,
  teamsFor,
  teamTrash,
  updateTeam,
} from '../services/teams.ts';

const number = z.coerce.number().int().positive();
const quota = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable();
const description = z.string().max(2000).nullable();
const color = z.string().max(20).nullable();

type TeamParams = { Params: { id: string } };
type MemberParams = { Params: { id: string; member: string } };

export async function teamRoutes(app: FastifyInstance) {
  app.get('/api/teams', async (request) => {
    const user = me(request);
    return { items: teamsFor(user).map((team) => presentTeam(team, user)) };
  });

  app.get('/api/admin/teams', async (request) => {
    const user = admin(request);
    return { items: listTeams().map((team) => presentTeam(team, user, true)) };
  });

  app.post('/api/admin/teams', async (request) => {
    const user = admin(request);
    const input = parse(
      z.object({ name: z.string().max(200), quota: quota.optional(), description: description.optional(), color: color.optional() }),
      request.body
    );
    return { team: presentTeam(await createTeam(user, input), user, true) };
  });

  app.delete<TeamParams & { Querystring: { confirm?: string } }>('/api/admin/teams/:id', async (request) => {
    deleteTeam(admin(request), parse(number, request.params.id), String(request.query.confirm ?? '').slice(0, 200));
    return { ok: true };
  });

  app.get<TeamParams & { Querystring: { q?: string } }>('/api/teams/:id/candidates', async (request) =>
    candidates(me(request), parse(number, request.params.id), String(request.query.q ?? '').slice(0, 100))
  );

  app.get<TeamParams>('/api/teams/:id', async (request) => {
    const user = me(request);
    const team = requireTeam(parse(number, request.params.id));
    if (user.role !== 'admin' && roleIn(team, user) === null) throw notFound('Diesen Teamordner gibt es nicht mehr');
    return { team: presentTeam(team, user, true) };
  });

  app.patch<TeamParams>('/api/teams/:id', async (request) => {
    const user = me(request);
    const input = parse(
      z.object({
        name: z.string().max(200).optional(),
        quota: quota.optional(),
        description: description.optional(),
        color: color.optional(),
      }),
      request.body
    );
    return { team: presentTeam(updateTeam(user, parse(number, request.params.id), input), user, true) };
  });

  app.put<MemberParams>('/api/teams/:id/people/:member', async (request) => {
    const user = me(request);
    const input = parse(z.object({ role: z.enum(['view', 'edit', 'manage']) }), request.body);
    const teamId = parse(number, request.params.id);
    setPerson(user, teamId, parse(number, request.params.member), input.role);
    return { team: presentTeam(requireTeam(teamId), user, true) };
  });

  app.delete<MemberParams>('/api/teams/:id/people/:member', async (request) => {
    const user = me(request);
    const teamId = parse(number, request.params.id);
    removePerson(user, teamId, parse(number, request.params.member));
    return { team: presentTeam(requireTeam(teamId), user, true) };
  });

  app.put<MemberParams>('/api/teams/:id/groups/:member', async (request) => {
    const user = me(request);
    const input = parse(z.object({ role: z.enum(['view', 'edit']) }), request.body);
    const teamId = parse(number, request.params.id);
    setGroup(user, teamId, parse(number, request.params.member), input.role);
    return { team: presentTeam(requireTeam(teamId), user, true) };
  });

  app.delete<MemberParams>('/api/teams/:id/groups/:member', async (request) => {
    const user = me(request);
    const teamId = parse(number, request.params.id);
    removeGroup(user, teamId, parse(number, request.params.member));
    return { team: presentTeam(requireTeam(teamId), user, true) };
  });

  app.post<TeamParams>('/api/teams/:id/leave', async (request) => {
    leaveTeam(me(request), parse(number, request.params.id));
    return { ok: true };
  });

  app.get<TeamParams>('/api/teams/:id/trash', async (request) => ({
    items: teamTrash(me(request), parse(number, request.params.id)),
  }));

  app.post<TeamParams>('/api/teams/:id/trash/restore', async (request) => {
    const input = parse(z.object({ ids }), request.body);
    return { restored: restoreInTeam(me(request), parse(number, request.params.id), input.ids) };
  });

  app.post<TeamParams>('/api/teams/:id/trash/delete', async (request) => {
    const input = parse(z.object({ ids }), request.body);
    return { removed: destroyInTeam(me(request), parse(number, request.params.id), input.ids) };
  });

  app.delete<TeamParams>('/api/teams/:id/trash', async (request) => ({
    removed: emptyTeamTrash(me(request), parse(number, request.params.id)),
  }));
}
