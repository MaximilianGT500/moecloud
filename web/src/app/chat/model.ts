import { api } from '../../lib/api';
import { Uploader } from '../../lib/upload';

export interface Status {
  state: 'available' | 'busy' | 'away' | 'dnd';
  emoji: string;
  text: string;
  until: number | null;
}

export interface Person {
  id: number;
  name: string;
  username: string;
  initials: string;
  avatar: string | null;
  status: Status | null;
}

export interface Room {
  id: string;
  kind: 'self' | 'direct' | 'group';
  name: string;
  topic: string;
  other: Person | null;
  members: number;
  role: 'owner' | 'member';
  unread: number;
  mentions: number;
  muted: boolean;
  pinned: boolean;
  lastAt: number;
  last: { preview: string; by: string; kind: 'text' | 'system'; deleted: boolean } | null;
}

export interface ChatFile {
  node: string;
  name: string;
  size: number;
  mime: string | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
}

export interface ChatMessage {
  id: number;
  room: string;
  kind: 'text' | 'system';
  user: Person | null;
  body: string;
  files: ChatFile[];
  replyTo: { id: number; name: string; preview: string } | null;
  reactions: Reaction[];
  editedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
}

export interface Member extends Person {
  role: 'owner' | 'member';
  readId: number;
}

export const chatApi = {
  rooms: () => api.get<{ rooms: Room[] }>('/api/chat/rooms'),
  details: (room: string) => api.get<{ room: Room; members: Member[] }>(`/api/chat/rooms/${room}`),
  messages: (room: string, before?: number) =>
    api.get<{ messages: ChatMessage[]; more: boolean }>(`/api/chat/rooms/${room}/messages${before ? `?before=${before}` : ''}`),
  send: (room: string, body: string, replyTo: number | null, files: string[]) =>
    api.post<{ message: ChatMessage }>(`/api/chat/rooms/${room}/messages`, { body, replyTo, files }),
  edit: (id: number, body: string) => api.patch<{ message: ChatMessage }>(`/api/chat/messages/${id}`, { body }),
  remove: (id: number) => api.delete(`/api/chat/messages/${id}`),
  react: (id: number, emoji: string) => api.post<{ reactions: Reaction[] }>(`/api/chat/messages/${id}/reactions`, { emoji }),
  read: (room: string, upTo?: number) => api.post(`/api/chat/rooms/${room}/read`, upTo ? { upTo } : {}),
  settings: (room: string, patch: { muted?: boolean; pinned?: boolean }) => api.patch(`/api/chat/rooms/${room}/settings`, patch),
  people: (q: string) => api.get<{ people: Person[] }>(`/api/chat/people?q=${encodeURIComponent(q)}`),
  open: (body: { kind: 'direct'; user: number } | { kind: 'group'; name: string; members: number[] } | { kind: 'self' }) =>
    api.post<{ room: Room }>('/api/chat/rooms', body),
};

export const fileUrl = (room: string, node: string, download = false) =>
  `/api/chat/rooms/${room}/files/${node}${download ? '?download=1' : ''}`;
export const thumbUrl = (room: string, node: string) => `/api/chat/rooms/${room}/files/${node}/thumb`;

export const isImage = (file: ChatFile) =>
  /^image\/(png|jpe?g|gif|webp|avif|heic|heif)$/i.test(file.mime ?? '') || /\.(png|jpe?g|gif|webp|avif|heic)$/i.test(file.name);

let uploader: Uploader | null = null;

export async function uploadToChat(files: File[], onProgress?: (share: number) => void) {
  const { id } = await api.post<{ id: string }>('/api/chat/folder');
  uploader ??= new Uploader();
  const engine = uploader;
  const before = new Set(engine.items.map((item) => item.key));
  engine.add(
    files.map((file) => ({ file })),
    id
  );
  const keys = engine.items.filter((item) => !before.has(item.key)).map((item) => item.key);
  return new Promise<{ node: string; name: string }[]>((resolve, reject) => {
    const check = () => {
      const items = engine.items.filter((item) => keys.includes(item.key));
      const total = items.reduce((sum, item) => sum + item.size, 0) || 1;
      onProgress?.(items.reduce((sum, item) => sum + item.loaded, 0) / total);
      if (items.some((item) => item.status === 'error' || item.status === 'cancelled')) {
        stop();
        reject(new Error(items.find((item) => item.error)?.error ?? 'upload'));
        return;
      }
      if (items.every((item) => item.status === 'done' && item.nodeId)) {
        stop();
        resolve(items.map((item) => ({ node: item.nodeId!, name: item.name })));
      }
    };
    const stop = engine.subscribe(check);
    check();
  });
}

export const QUICK = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

export function systemText(body: string, t: (key: string, params?: Record<string, string | number>) => string) {
  try {
    const data = JSON.parse(body) as { event: string; by: string; name?: string; names?: string[] };
    switch (data.event) {
      case 'created':
        return t('{name} hat die Gruppe gegründet', { name: data.by });
      case 'renamed':
        return t('{name} hat die Gruppe in „{title}“ umbenannt', { name: data.by, title: data.name ?? '' });
      case 'added':
        return t('{name} hat {names} dazugeholt', { name: data.by, names: (data.names ?? []).join(', ') });
      case 'removed':
        return t('{name} hat {names} entfernt', { name: data.by, names: (data.names ?? []).join(', ') });
      case 'left':
        return t('{name} hat die Gruppe verlassen', { name: data.by });
      default:
        return '';
    }
  } catch {
    return '';
  }
}
