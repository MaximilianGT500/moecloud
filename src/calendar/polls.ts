import { all, one, run, tx } from '../lib/db.ts';
import { randomId, sha256 } from '../lib/crypto.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { isZone } from '../../shared/time.ts';
import { createItem } from './events.ts';
import { notify } from '../services/notify.ts';
import * as settings from '../services/settings.ts';
import { getUser, zoneOf, type UserRow } from '../services/users.ts';

export interface PollOption {
  id: string;
  start: number;
  end: number;
  allDay: boolean;
}

export interface PollSettings {
  maybe: boolean;
  hidden: boolean;
  email: boolean;
  limit: number;
}

interface PollRow {
  id: string;
  owner_id: number;
  token: string;
  title: string;
  description: string | null;
  location: string | null;
  zone: string;
  options: string;
  settings: string | null;
  deadline: number | null;
  closed_at: number | null;
  final_option: string | null;
  event_id: string | null;
  created_at: number;
  updated_at: number;
}

interface VoteRow {
  id: string;
  poll_id: string;
  name: string;
  email: string | null;
  user_id: number | null;
  answers: string;
  comment: string | null;
  token_hash: string;
  created_at: number;
  updated_at: number;
}

export type Answer = 'yes' | 'maybe' | 'no';

const DEFAULT_SETTINGS: PollSettings = { maybe: true, hidden: false, email: false, limit: 0 };

const settingsOf = (row: PollRow): PollSettings => {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.settings ?? '{}') as Partial<PollSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const optionsOf = (row: PollRow) => JSON.parse(row.options) as PollOption[];

const getPoll = (id: string) => one<PollRow>('SELECT * FROM polls WHERE id = ?', id);

function requirePoll(user: UserRow, id: string) {
  const poll = getPoll(id);
  if (!poll || poll.owner_id !== user.id) throw notFound('Diese Umfrage gibt es nicht');
  return poll;
}

const votesOf = (pollId: string) => all<VoteRow>('SELECT * FROM poll_votes WHERE poll_id = ? ORDER BY created_at', pollId);

function tally(options: PollOption[], votes: VoteRow[]) {
  return options.map((option) => {
    let yes = 0;
    let maybe = 0;
    for (const vote of votes) {
      const answers = JSON.parse(vote.answers) as Record<string, Answer>;
      if (answers[option.id] === 'yes') yes++;
      else if (answers[option.id] === 'maybe') maybe++;
    }
    return { id: option.id, yes, maybe, score: yes * 2 + maybe };
  });
}

export function presentPoll(row: PollRow, owner: boolean) {
  const options = optionsOf(row);
  const votes = votesOf(row.id);
  const pollSettings = settingsOf(row);
  const showVotes = owner || !pollSettings.hidden;
  const user = getUser(row.owner_id);
  const closed = Boolean(row.closed_at) || Boolean(row.deadline && row.deadline < Date.now());
  return {
    id: owner ? row.id : undefined,
    token: row.token,
    title: row.title,
    description: row.description ?? '',
    location: row.location ?? '',
    zone: row.zone,
    options,
    settings: pollSettings,
    deadline: row.deadline,
    closed,
    finalOption: row.final_option,
    eventId: owner ? row.event_id : null,
    owner: user?.name ?? '',
    votes: showVotes
      ? votes.map((vote) => ({
          id: vote.id,
          name: vote.name,
          email: owner ? vote.email : null,
          answers: JSON.parse(vote.answers) as Record<string, Answer>,
          comment: vote.comment ?? '',
          createdAt: vote.created_at,
        }))
      : [],
    count: votes.length,
    tally: showVotes ? tally(options, votes) : [],
    createdAt: row.created_at,
  };
}

export const listPolls = (user: UserRow) =>
  all<PollRow>('SELECT * FROM polls WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200', user.id).map((row) => presentPoll(row, true));

export interface PollInput {
  title?: string;
  description?: string;
  location?: string;
  zone?: string;
  options?: { id?: string; start: number; end: number; allDay?: boolean }[];
  settings?: Partial<PollSettings>;
  deadline?: number | null;
}

function cleanOptions(list: NonNullable<PollInput['options']>, existing: PollOption[] = []) {
  if (!list.length) throw badRequest('Schlag mindestens einen Termin vor');
  if (list.length > 60) throw badRequest('Höchstens 60 Vorschläge pro Umfrage');
  return list
    .map((option) => ({
      id: option.id && existing.some((entry) => entry.id === option.id) ? option.id : randomId(10),
      start: Math.round(option.start),
      end: Math.max(Math.round(option.end), Math.round(option.start)),
      allDay: Boolean(option.allDay),
    }))
    .sort((a, b) => a.start - b.start);
}

export function createPoll(user: UserRow, input: PollInput) {
  if (!settings.get('calendar.polls')) throw forbidden('Terminumfragen sind auf diesem Server ausgeschaltet');
  const id = randomId(16);
  const token = randomId(24);
  const now = Date.now();
  run(
    `INSERT INTO polls (id, owner_id, token, title, description, location, zone, options, settings, deadline, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    token,
    input.title?.trim().slice(0, 150) || 'Terminumfrage',
    input.description?.slice(0, 4000) ?? null,
    input.location?.slice(0, 500) ?? null,
    input.zone && isZone(input.zone) ? input.zone : zoneOf(user),
    JSON.stringify(cleanOptions(input.options ?? [])),
    JSON.stringify({ ...DEFAULT_SETTINGS, ...(input.settings ?? {}) }),
    input.deadline ?? null,
    now,
    now
  );
  return presentPoll(getPoll(id)!, true);
}

export function updatePoll(user: UserRow, id: string, input: PollInput) {
  const poll = requirePoll(user, id);
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (input.title !== undefined) set('title', input.title.trim().slice(0, 150) || poll.title);
  if (input.description !== undefined) set('description', input.description.slice(0, 4000));
  if (input.location !== undefined) set('location', input.location.slice(0, 500));
  if (input.zone !== undefined && isZone(input.zone)) set('zone', input.zone);
  if (input.options !== undefined) set('options', JSON.stringify(cleanOptions(input.options, optionsOf(poll))));
  if (input.settings !== undefined) set('settings', JSON.stringify({ ...settingsOf(poll), ...input.settings }));
  if (input.deadline !== undefined) set('deadline', input.deadline);
  set('updated_at', Date.now());
  run(`UPDATE polls SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  return presentPoll(getPoll(id)!, true);
}

export function deletePoll(user: UserRow, id: string) {
  requirePoll(user, id);
  run('DELETE FROM polls WHERE id = ?', id);
}

export function closePoll(user: UserRow, id: string, closed: boolean) {
  requirePoll(user, id);
  run('UPDATE polls SET closed_at = ?, updated_at = ? WHERE id = ?', closed ? Date.now() : null, Date.now(), id);
  return presentPoll(getPoll(id)!, true);
}

export function finalizePoll(user: UserRow, id: string, input: { option: string; calendarId: string; invite: boolean }) {
  const poll = requirePoll(user, id);
  const option = optionsOf(poll).find((entry) => entry.id === input.option);
  if (!option) throw notFound('Diesen Vorschlag gibt es nicht');
  const voters = votesOf(poll.id).filter((vote) => {
    const answers = JSON.parse(vote.answers) as Record<string, Answer>;
    return vote.email && answers[option.id] !== 'no';
  });
  return tx(() => {
    const row = createItem(user, {
      calendarId: input.calendarId,
      title: poll.title,
      description: poll.description ?? '',
      location: poll.location ?? '',
      allDay: option.allDay,
      start: option.allDay ? new Date(option.start).toISOString().slice(0, 10) : option.start,
      end: option.allDay ? new Date(option.end).toISOString().slice(0, 10) : option.end,
      zone: poll.zone,
      attendees: input.invite ? voters.map((vote) => ({ email: vote.email!, name: vote.name })) : [],
    });
    run(
      'UPDATE polls SET final_option = ?, event_id = ?, closed_at = ?, updated_at = ? WHERE id = ?',
      option.id,
      row.id,
      Date.now(),
      Date.now(),
      id
    );
    return { poll: presentPoll(getPoll(id)!, true), eventId: row.id };
  });
}

export const pollByToken = (token: string) =>
  token && token.length <= 64 ? one<PollRow>('SELECT * FROM polls WHERE token = ?', token) : undefined;

export interface VoteInput {
  name: string;
  email?: string | null;
  answers: Record<string, Answer>;
  comment?: string | null;
}

function cleanVote(poll: PollRow, input: VoteInput) {
  const name = input.name.trim().slice(0, 80);
  if (!name) throw badRequest('Gib deinen Namen ein');
  const pollSettings = settingsOf(poll);
  const email = input.email?.trim().toLowerCase() || null;
  if (pollSettings.email && !email) throw badRequest('Gib deine E-Mail-Adresse ein');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Die E-Mail-Adresse sieht nicht richtig aus');
  const answers: Record<string, Answer> = {};
  for (const option of optionsOf(poll)) {
    const answer = input.answers[option.id];
    answers[option.id] = answer === 'yes' || (answer === 'maybe' && pollSettings.maybe) ? answer : 'no';
  }
  if (pollSettings.limit) {
    const counts = tally(optionsOf(poll), votesOf(poll.id));
    for (const option of optionsOf(poll)) {
      if (answers[option.id] !== 'yes') continue;
      const count = counts.find((entry) => entry.id === option.id)?.yes ?? 0;
      if (count >= pollSettings.limit) throw badRequest('Für einen Vorschlag sind schon alle Plätze vergeben, wähl bitte einen anderen');
    }
  }
  return { name, email, answers, comment: input.comment?.trim().slice(0, 1000) || null };
}

function assertOpen(poll: PollRow) {
  if (poll.closed_at || (poll.deadline && poll.deadline < Date.now())) throw forbidden('Diese Umfrage ist beendet');
}

export function vote(token: string, input: VoteInput, user: UserRow | null) {
  const poll = pollByToken(token);
  if (!poll) throw notFound('Diese Umfrage gibt es nicht');
  assertOpen(poll);
  const clean = cleanVote(poll, input);
  const id = randomId(16);
  const edit = randomId(24);
  const now = Date.now();
  run(
    'INSERT INTO poll_votes (id, poll_id, name, email, user_id, answers, comment, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    poll.id,
    clean.name,
    clean.email,
    user?.id ?? null,
    JSON.stringify(clean.answers),
    clean.comment,
    sha256(edit),
    now,
    now
  );
  const count = votesOf(poll.id).length;
  notify(poll.owner_id, 'poll_vote', { name: clean.name, title: poll.title, count }, `/calendar/polls?poll=${poll.id}`);
  return { voteId: id, editToken: edit, poll: presentPoll(poll, false) };
}

export function editVote(token: string, editToken: string, input: VoteInput) {
  const poll = pollByToken(token);
  if (!poll) throw notFound('Diese Umfrage gibt es nicht');
  assertOpen(poll);
  const existing = one<VoteRow>('SELECT * FROM poll_votes WHERE poll_id = ? AND token_hash = ?', poll.id, sha256(editToken));
  if (!existing) throw notFound('Diese Stimme gibt es nicht mehr');
  const clean = cleanVote(poll, input);
  run(
    'UPDATE poll_votes SET name = ?, email = ?, answers = ?, comment = ?, updated_at = ? WHERE id = ?',
    clean.name,
    clean.email,
    JSON.stringify(clean.answers),
    clean.comment,
    Date.now(),
    existing.id
  );
  return { voteId: existing.id, poll: presentPoll(poll, false) };
}

export function voteByToken(token: string, editToken: string) {
  const poll = pollByToken(token);
  if (!poll) return null;
  const existing = one<VoteRow>('SELECT * FROM poll_votes WHERE poll_id = ? AND token_hash = ?', poll.id, sha256(editToken));
  if (!existing) return null;
  return {
    id: existing.id,
    name: existing.name,
    email: existing.email,
    answers: JSON.parse(existing.answers) as Record<string, Answer>,
    comment: existing.comment ?? '',
  };
}

export function removeVote(user: UserRow, pollId: string, voteId: string) {
  requirePoll(user, pollId);
  run('DELETE FROM poll_votes WHERE id = ? AND poll_id = ?', voteId, pollId);
  return presentPoll(getPoll(pollId)!, true);
}
