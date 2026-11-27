import { all, one, run, tx, value } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { publish } from '../lib/events.ts';
import { countBadge, pushBadge } from '../services/badges.ts';
import { getNode, resolveAccess } from '../services/nodes.ts';
import { notify, notifyMerged } from '../services/notify.ts';
import { statusMap, type UserStatus } from '../services/status.ts';
import { getUser, initials, type UserRow } from '../services/users.ts';

export type RoomKind = 'self' | 'direct' | 'group';

export interface RoomRow {
  id: string;
  kind: RoomKind;
  name: string;
  topic: string;
  pair: string | null;
  created_by: number | null;
  created_at: number;
  updated_at: number;
  last_at: number;
}

export interface MemberRow {
  room_id: string;
  user_id: number;
  role: 'owner' | 'member';
  read_id: number;
  muted: number;
  pinned: number;
  hidden: number;
  joined_at: number;
}

export interface MessageRow {
  id: number;
  room_id: string;
  user_id: number | null;
  kind: 'text' | 'system';
  body: string;
  reply_to: number | null;
  files: string | null;
  edited_at: number | null;
  deleted_at: number | null;
  created_at: number;
}

export interface ChatFile {
  node: string;
  name: string;
  size: number;
  mime: string | null;
}

const MAX_BODY = 8000;
const PAGE = 50;

const members = (roomId: string) => all<MemberRow>('SELECT * FROM chat_members WHERE room_id = ?', roomId);
const memberIds = (roomId: string) => members(roomId).map((member) => member.user_id);

export function membership(user: Pick<UserRow, 'id'>, roomId: string) {
  const room = one<RoomRow>('SELECT * FROM chat_rooms WHERE id = ?', roomId);
  const member = room ? one<MemberRow>('SELECT * FROM chat_members WHERE room_id = ? AND user_id = ?', roomId, user.id) : undefined;
  if (!room || !member) throw notFound('Diesen Chat gibt es nicht');
  return { room, member };
}

interface Person {
  id: number;
  name: string;
  username: string;
  initials: string;
  avatar: string | null;
  status: UserStatus | null;
}

function people(ids: Iterable<number>) {
  const list = [...new Set(ids)];
  const statuses = statusMap(list);
  const map = new Map<number, Person>();
  for (const id of list) {
    const user = getUser(id);
    if (!user) continue;
    map.set(id, {
      id,
      name: user.name,
      username: user.username,
      initials: initials(user.name),
      avatar: user.avatar,
      status: statuses.get(id) ?? null,
    });
  }
  return map;
}

const preview = (row: Pick<MessageRow, 'body' | 'files' | 'deleted_at' | 'kind'>) => {
  if (row.deleted_at) return '';
  const text = row.body.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, 140);
  const files = filesOf(row);
  return files.length ? `📎 ${files.map((file) => file.name).join(', ')}`.slice(0, 140) : '';
};

const filesOf = (row: Pick<MessageRow, 'files'>): ChatFile[] => {
  if (!row.files) return [];
  try {
    return JSON.parse(row.files) as ChatFile[];
  } catch {
    return [];
  }
};

export function unreadIn(roomId: string, member: Pick<MemberRow, 'read_id' | 'user_id'>) {
  return (
    value<number>(
      'SELECT COUNT(*) FROM chat_messages WHERE room_id = ? AND id > ? AND (user_id IS NULL OR user_id != ?) AND deleted_at IS NULL',
      roomId,
      member.read_id,
      member.user_id
    ) ?? 0
  );
}

export function unreadTotal(user: Pick<UserRow, 'id'>) {
  return (
    value<number>(
      `SELECT COUNT(*) FROM chat_messages m JOIN chat_members c ON c.room_id = m.room_id AND c.user_id = ?
       WHERE m.id > c.read_id AND (m.user_id IS NULL OR m.user_id != ?) AND m.deleted_at IS NULL AND c.muted = 0`,
      user.id,
      user.id
    ) ?? 0
  );
}

countBadge('chat', unreadTotal);

const announceBadges = (ids: Iterable<number>) => {
  for (const id of ids) pushBadge([id], { chat: unreadTotal({ id }) });
};

function titleOf(room: RoomRow, viewer: number, names: Map<number, Person>, ids: number[]) {
  if (room.kind === 'self') return { name: '', other: null as Person | null };
  if (room.kind === 'direct') {
    const other = names.get(ids.find((id) => id !== viewer) ?? -1) ?? null;
    return { name: other?.name ?? '', other };
  }
  return { name: room.name, other: null as Person | null };
}

export function presentRoom(room: RoomRow, viewer: UserRow, member: MemberRow) {
  const ids = memberIds(room.id);
  const names = people(ids);
  const last = one<MessageRow>('SELECT * FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT 1', room.id);
  const title = titleOf(room, viewer.id, names, ids);
  const mentions = value<number>(
    "SELECT COUNT(*) FROM chat_messages WHERE room_id = ? AND id > ? AND deleted_at IS NULL AND (body LIKE ? ESCAPE '\\')",
    room.id,
    member.read_id,
    `%@${viewer.username.replace(/[%_\\]/g, (char) => `\\${char}`)}%`
  );
  return {
    id: room.id,
    kind: room.kind,
    name: title.name,
    topic: room.topic,
    other: title.other,
    members: ids.length,
    role: member.role,
    unread: unreadIn(room.id, member),
    mentions: mentions ?? 0,
    muted: Boolean(member.muted),
    pinned: Boolean(member.pinned),
    lastAt: room.last_at,
    last: last
      ? {
          preview: preview(last),
          by: last.user_id === viewer.id ? 'me' : (names.get(last.user_id ?? -1)?.name ?? ''),
          kind: last.kind,
          deleted: Boolean(last.deleted_at),
        }
      : null,
  };
}

export type PresentedRoom = ReturnType<typeof presentRoom>;

export function listRooms(user: UserRow) {
  ensureSelf(user);
  return all<RoomRow & { member_role: string }>(
    `SELECT r.* FROM chat_rooms r JOIN chat_members m ON m.room_id = r.id WHERE m.user_id = ? AND m.hidden = 0
     ORDER BY m.pinned DESC, r.last_at DESC`,
    user.id
  ).map((room) =>
    presentRoom(room, user, one<MemberRow>('SELECT * FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, user.id)!)
  );
}

function insertRoom(kind: RoomKind, name: string, pair: string | null, creator: number, ids: number[]) {
  const id = randomId(16);
  const now = Date.now();
  tx(() => {
    run(
      'INSERT INTO chat_rooms (id, kind, name, topic, pair, created_by, created_at, updated_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      kind,
      name,
      '',
      pair,
      creator,
      now,
      now,
      now
    );
    for (const userId of new Set(ids)) {
      run(
        'INSERT INTO chat_members (room_id, user_id, role, read_id, muted, pinned, hidden, joined_at) VALUES (?, ?, ?, 0, 0, 0, 0, ?)',
        id,
        userId,
        userId === creator ? 'owner' : 'member',
        now
      );
    }
  });
  return one<RoomRow>('SELECT * FROM chat_rooms WHERE id = ?', id)!;
}

export function ensureSelf(user: UserRow) {
  const pair = `self:${user.id}`;
  return one<RoomRow>('SELECT * FROM chat_rooms WHERE pair = ?', pair) ?? insertRoom('self', '', pair, user.id, [user.id]);
}

const chatPerson = (user: UserRow | undefined) =>
  Boolean(user) && !user!.disabled && !user!.pending && (user!.role === 'user' || user!.role === 'admin');

export function openDirect(user: UserRow, otherId: number) {
  if (otherId === user.id) return ensureSelf(user);
  const other = getUser(otherId);
  if (!chatPerson(other)) throw notFound('Diese Person gibt es nicht');
  const pair = `${Math.min(user.id, otherId)}:${Math.max(user.id, otherId)}`;
  const existing = one<RoomRow>('SELECT * FROM chat_rooms WHERE pair = ?', pair);
  if (existing) {
    run('UPDATE chat_members SET hidden = 0 WHERE room_id = ? AND user_id = ?', existing.id, user.id);
    return existing;
  }
  return insertRoom('direct', '', pair, user.id, [user.id, otherId]);
}

function systemMessage(room: RoomRow, body: string, actor: number | null) {
  const now = Date.now();
  const { lastId } = run(
    "INSERT INTO chat_messages (room_id, user_id, kind, body, created_at) VALUES (?, ?, 'system', ?, ?)",
    room.id,
    actor,
    body,
    now
  );
  run('UPDATE chat_rooms SET last_at = ?, updated_at = ? WHERE id = ?', now, now, room.id);
  return Number(lastId);
}

export function createGroup(user: UserRow, name: string, memberList: number[]) {
  const ids = [...new Set(memberList.filter((id) => id !== user.id))];
  for (const id of ids) if (!chatPerson(getUser(id))) throw notFound('Diese Person gibt es nicht');
  const room = insertRoom('group', name, null, user.id, [user.id, ...ids]);
  systemMessage(room, JSON.stringify({ event: 'created', by: user.name }), user.id);
  for (const id of ids) notify(id, 'chat_added', { by: user.name, room: name }, `/chat?room=${room.id}`, { mail: false });
  publish([user.id, ...ids], 'chat', { type: 'room', room: room.id });
  return room;
}

export function updateRoom(user: UserRow, roomId: string, patch: { name?: string; topic?: string }) {
  const { room } = membership(user, roomId);
  if (room.kind !== 'group') throw new HttpError(400, 'Nur Gruppen haben einen Namen', 'chat_kind');
  run(
    'UPDATE chat_rooms SET name = ?, topic = ?, updated_at = ? WHERE id = ?',
    patch.name ?? room.name,
    patch.topic ?? room.topic,
    Date.now(),
    room.id
  );
  if (patch.name && patch.name !== room.name)
    systemMessage(room, JSON.stringify({ event: 'renamed', by: user.name, name: patch.name }), user.id);
  publish(memberIds(room.id), 'chat', { type: 'room', room: room.id });
}

export function addMembers(user: UserRow, roomId: string, ids: number[]) {
  const { room } = membership(user, roomId);
  if (room.kind !== 'group') throw new HttpError(400, 'In diesen Chat kannst du niemanden dazuholen', 'chat_kind');
  const current = new Set(memberIds(room.id));
  const added: UserRow[] = [];
  for (const id of new Set(ids)) {
    if (current.has(id)) continue;
    const person = getUser(id);
    if (!chatPerson(person)) throw notFound('Diese Person gibt es nicht');
    run(
      "INSERT INTO chat_members (room_id, user_id, role, read_id, muted, pinned, hidden, joined_at) VALUES (?, ?, 'member', 0, 0, 0, 0, ?)",
      room.id,
      id,
      Date.now()
    );
    added.push(person!);
  }
  if (added.length) {
    systemMessage(room, JSON.stringify({ event: 'added', by: user.name, names: added.map((entry) => entry.name) }), user.id);
    for (const person of added)
      notify(person.id, 'chat_added', { by: user.name, room: room.name }, `/chat?room=${room.id}`, { mail: false });
    publish(memberIds(room.id), 'chat', { type: 'room', room: room.id });
  }
}

export function removeMember(user: UserRow, roomId: string, target: number) {
  const { room, member } = membership(user, roomId);
  if (room.kind !== 'group') {
    run('UPDATE chat_members SET hidden = 1 WHERE room_id = ? AND user_id = ?', room.id, user.id);
    return;
  }
  if (target !== user.id && member.role !== 'owner')
    throw new HttpError(403, 'Nur wer die Gruppe angelegt hat, kann andere entfernen', 'chat_owner');
  const removed = getUser(target);
  const before = memberIds(room.id);
  run('DELETE FROM chat_members WHERE room_id = ? AND user_id = ?', room.id, target);
  const left = memberIds(room.id);
  if (!left.length) {
    run('DELETE FROM chat_rooms WHERE id = ?', room.id);
    return;
  }
  if (!left.some((id) => one<MemberRow>("SELECT * FROM chat_members WHERE room_id = ? AND user_id = ? AND role = 'owner'", room.id, id))) {
    run("UPDATE chat_members SET role = 'owner' WHERE room_id = ? AND user_id = ?", room.id, left[0]);
  }
  systemMessage(
    room,
    JSON.stringify(
      target === user.id ? { event: 'left', by: user.name } : { event: 'removed', by: user.name, names: [removed?.name ?? '?'] }
    ),
    user.id
  );
  publish(before, 'chat', { type: 'room', room: room.id });
}

export function memberSettings(user: UserRow, roomId: string, patch: { muted?: boolean; pinned?: boolean }) {
  const { member } = membership(user, roomId);
  run(
    'UPDATE chat_members SET muted = ?, pinned = ? WHERE room_id = ? AND user_id = ?',
    patch.muted === undefined ? member.muted : patch.muted ? 1 : 0,
    patch.pinned === undefined ? member.pinned : patch.pinned ? 1 : 0,
    roomId,
    user.id
  );
  announceBadges([user.id]);
}

export function markRead(user: UserRow, roomId: string, upTo?: number) {
  const { room } = membership(user, roomId);
  const latest = upTo ?? value<number>('SELECT MAX(id) FROM chat_messages WHERE room_id = ?', room.id) ?? 0;
  run(
    'UPDATE chat_members SET read_id = CASE WHEN read_id > ? THEN read_id ELSE ? END WHERE room_id = ? AND user_id = ?',
    latest,
    latest,
    room.id,
    user.id
  );
  publish(memberIds(room.id), 'chat', { type: 'read', room: room.id, user: user.id, upTo: latest });
  announceBadges([user.id]);
}

export function roomDetails(user: UserRow, roomId: string) {
  const { room, member } = membership(user, roomId);
  const rows = members(room.id);
  const names = people(rows.map((row) => row.user_id));
  return {
    room: presentRoom(room, user, member),
    members: rows
      .map((row) => ({ ...names.get(row.user_id)!, role: row.role, readId: row.read_id }))
      .filter((entry) => entry.id)
      .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'owner' ? -1 : 1)),
  };
}

function reactionsOf(ids: number[], viewer: number) {
  const map = new Map<number, { emoji: string; count: number; mine: boolean; names: string[] }[]>();
  if (!ids.length) return map;
  const rows = all<{ message_id: number; user_id: number; emoji: string }>(
    `SELECT message_id, user_id, emoji FROM chat_reactions WHERE message_id IN (${ids.map(() => '?').join(', ')}) ORDER BY created_at`,
    ...ids
  );
  const names = people(rows.map((row) => row.user_id));
  for (const row of rows) {
    const list = map.get(row.message_id) ?? [];
    let entry = list.find((item) => item.emoji === row.emoji);
    if (!entry) {
      entry = { emoji: row.emoji, count: 0, mine: false, names: [] };
      list.push(entry);
    }
    entry.count++;
    entry.mine ||= row.user_id === viewer;
    entry.names.push(names.get(row.user_id)?.name ?? '?');
    map.set(row.message_id, list);
  }
  return map;
}

export function presentMessages(rows: MessageRow[], viewer: number) {
  const authors = people(rows.flatMap((row) => (row.user_id ? [row.user_id] : [])));
  const replies = new Map<number, MessageRow>();
  const replyIds = [...new Set(rows.flatMap((row) => (row.reply_to ? [row.reply_to] : [])))];
  if (replyIds.length) {
    for (const row of all<MessageRow>(`SELECT * FROM chat_messages WHERE id IN (${replyIds.map(() => '?').join(', ')})`, ...replyIds))
      replies.set(row.id, row);
  }
  const replyAuthors = people([...replies.values()].flatMap((row) => (row.user_id ? [row.user_id] : [])));
  const reactions = reactionsOf(
    rows.map((row) => row.id),
    viewer
  );
  return rows.map((row) => {
    const reply = row.reply_to ? replies.get(row.reply_to) : undefined;
    return {
      id: row.id,
      room: row.room_id,
      kind: row.kind,
      user: row.user_id ? (authors.get(row.user_id) ?? null) : null,
      body: row.deleted_at ? '' : row.body,
      files: row.deleted_at ? [] : filesOf(row),
      replyTo: reply
        ? { id: reply.id, name: replyAuthors.get(reply.user_id ?? -1)?.name ?? '', preview: preview(reply) }
        : row.reply_to
          ? { id: row.reply_to, name: '', preview: '' }
          : null,
      reactions: reactions.get(row.id) ?? [],
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
    };
  });
}

export type PresentedMessage = ReturnType<typeof presentMessages>[number];

export function listMessages(user: UserRow, roomId: string, before: number | null, limit = PAGE) {
  membership(user, roomId);
  const rows = before
    ? all<MessageRow>('SELECT * FROM chat_messages WHERE room_id = ? AND id < ? ORDER BY id DESC LIMIT ?', roomId, before, limit + 1)
    : all<MessageRow>('SELECT * FROM chat_messages WHERE room_id = ? ORDER BY id DESC LIMIT ?', roomId, limit + 1);
  const more = rows.length > limit;
  return { messages: presentMessages(rows.slice(0, limit).reverse(), user.id), more };
}

function attach(user: UserRow, nodes: string[]): ChatFile[] {
  return nodes.map((id) => {
    const access = resolveAccess(user, id);
    const node = getNode(id);
    if (!access || !node || node.type !== 'file' || node.trashed_at) throw new HttpError(404, 'Eine Datei gibt es nicht mehr', 'chat_file');
    return { node: node.id, name: node.name, size: node.size, mime: node.mime };
  });
}

const mentionsIn = (body: string) =>
  new Set([...body.matchAll(/(?:^|[\s(])@([a-zA-Z0-9._-]{2,32})/g)].map((match) => match[1].toLowerCase()));

export function sendMessage(user: UserRow, roomId: string, input: { body: string; replyTo?: number | null; files?: string[] }) {
  const { room } = membership(user, roomId);
  const body = input.body.replace(/\r\n/g, '\n').trim();
  if (body.length > MAX_BODY)
    throw new HttpError(400, 'Eine Nachricht darf höchstens {count} Zeichen haben', 'chat_long', { count: MAX_BODY });
  const files = attach(user, input.files ?? []);
  if (!body && !files.length) throw new HttpError(400, 'Die Nachricht ist leer', 'chat_empty');
  if (input.replyTo && !one('SELECT 1 FROM chat_messages WHERE id = ? AND room_id = ?', input.replyTo, room.id)) {
    throw new HttpError(404, 'Diese Nachricht gibt es nicht mehr', 'chat_reply');
  }
  const now = Date.now();
  const { lastId } = run(
    "INSERT INTO chat_messages (room_id, user_id, kind, body, reply_to, files, created_at) VALUES (?, ?, 'text', ?, ?, ?, ?)",
    room.id,
    user.id,
    body,
    input.replyTo ?? null,
    files.length ? JSON.stringify(files) : null,
    now
  );
  const id = Number(lastId);
  run('UPDATE chat_rooms SET last_at = ?, updated_at = ? WHERE id = ?', now, now, room.id);
  run('UPDATE chat_members SET read_id = ?, hidden = 0 WHERE room_id = ? AND user_id = ?', id, room.id, user.id);
  run('UPDATE chat_members SET hidden = 0 WHERE room_id = ?', room.id);
  const row = one<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', id)!;
  const ids = memberIds(room.id);
  const [message] = presentMessages([row], user.id);
  publish(ids, 'chat', { type: 'message', room: room.id, message });
  const others = members(room.id).filter((member) => member.user_id !== user.id);
  announceBadges(others.map((member) => member.user_id));
  const mentioned = mentionsIn(body);
  const short = preview(row);
  for (const member of others) {
    const person = getUser(member.user_id);
    if (!person) continue;
    const called = mentioned.has(person.username.toLowerCase()) || mentioned.has('alle') || mentioned.has('all');
    if (member.muted && !called) continue;
    const url = `/chat?room=${room.id}`;
    if (room.kind === 'direct') notifyMerged(person.id, 'chat_message', { by: user.name, preview: short }, url, 30 * 60 * 1000);
    else if (called) notify(person.id, 'chat_mention', { by: user.name, room: room.name, preview: short }, url, { mail: false });
  }
  return message;
}

export function editMessage(user: UserRow, messageId: number, body: string) {
  const row = one<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', messageId);
  if (!row) throw notFound('Diese Nachricht gibt es nicht');
  membership(user, row.room_id);
  if (row.user_id !== user.id || row.kind !== 'text' || row.deleted_at)
    throw new HttpError(403, 'Du kannst nur eigene Nachrichten bearbeiten', 'chat_own');
  const text = body.replace(/\r\n/g, '\n').trim();
  if (!text && !filesOf(row).length) throw new HttpError(400, 'Die Nachricht ist leer', 'chat_empty');
  if (text.length > MAX_BODY)
    throw new HttpError(400, 'Eine Nachricht darf höchstens {count} Zeichen haben', 'chat_long', { count: MAX_BODY });
  run('UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?', text, Date.now(), row.id);
  const [message] = presentMessages([one<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', row.id)!], user.id);
  publish(memberIds(row.room_id), 'chat', { type: 'edit', room: row.room_id, message });
  return message;
}

export function deleteMessage(user: UserRow, messageId: number) {
  const row = one<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', messageId);
  if (!row) throw notFound('Diese Nachricht gibt es nicht');
  const { member } = membership(user, row.room_id);
  if (row.user_id !== user.id && member.role !== 'owner') throw new HttpError(403, 'Du kannst nur eigene Nachrichten löschen', 'chat_own');
  run("UPDATE chat_messages SET body = '', files = NULL, deleted_at = ? WHERE id = ?", Date.now(), row.id);
  run('DELETE FROM chat_reactions WHERE message_id = ?', row.id);
  publish(memberIds(row.room_id), 'chat', { type: 'delete', room: row.room_id, id: row.id });
  announceBadges(memberIds(row.room_id));
}

export function toggleReaction(user: UserRow, messageId: number, emoji: string) {
  const row = one<MessageRow>('SELECT * FROM chat_messages WHERE id = ?', messageId);
  if (!row || row.deleted_at) throw notFound('Diese Nachricht gibt es nicht');
  membership(user, row.room_id);
  const existing = one('SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', row.id, user.id, emoji);
  if (existing) run('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?', row.id, user.id, emoji);
  else {
    if ((value<number>('SELECT COUNT(DISTINCT emoji) FROM chat_reactions WHERE message_id = ?', row.id) ?? 0) >= 20) {
      throw new HttpError(400, 'Mehr Reaktionen passen nicht dran', 'chat_reactions');
    }
    run('INSERT INTO chat_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', row.id, user.id, emoji, Date.now());
  }
  const reactions = reactionsOf([row.id], user.id).get(row.id) ?? [];
  publish(memberIds(row.room_id), 'chat', { type: 'reaction', room: row.room_id, id: row.id });
  return reactions;
}

export function chatFile(user: UserRow, roomId: string, nodeId: string) {
  membership(user, roomId);
  const found = one<MessageRow>(
    "SELECT * FROM chat_messages WHERE room_id = ? AND deleted_at IS NULL AND files LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 1",
    roomId,
    `%"node":"${nodeId.replace(/[%_\\"]/g, '')}"%`
  );
  if (!found || !filesOf(found).some((file) => file.node === nodeId)) throw notFound('Diese Datei gibt es nicht');
  const node = getNode(nodeId);
  if (!node || node.type !== 'file' || node.trashed_at || !node.sha256) throw notFound('Diese Datei gibt es nicht mehr');
  return node;
}

export function searchChat(user: UserRow, query: string, limit = 8) {
  const like = `%${query.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
  const rows = all<MessageRow>(
    `SELECT m.* FROM chat_messages m JOIN chat_members c ON c.room_id = m.room_id AND c.user_id = ?
     WHERE m.kind = 'text' AND m.deleted_at IS NULL AND m.body LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT ?`,
    user.id,
    like,
    limit
  );
  const authors = people(rows.flatMap((row) => (row.user_id ? [row.user_id] : [])));
  return rows.map((row) => {
    const room = one<RoomRow>('SELECT * FROM chat_rooms WHERE id = ?', row.room_id)!;
    const member = one<MemberRow>('SELECT * FROM chat_members WHERE room_id = ? AND user_id = ?', row.room_id, user.id)!;
    return {
      id: row.id,
      room: row.room_id,
      roomName: presentRoom(room, user, member).name,
      by: authors.get(row.user_id ?? -1)?.name ?? '',
      preview: preview(row),
      at: row.created_at,
    };
  });
}
