import { api, csrfToken } from '../../lib/api';
import { t } from '../../lib/i18n';

export type Security = 'tls' | 'starttls' | 'none';

export interface Endpoint {
  host: string;
  port: number;
  security: Security;
}

export interface MailAccount {
  id: string;
  name: string;
  email: string;
  displayName: string;
  login: string;
  imap: Endpoint;
  smtp: Endpoint;
  smtpLogin: string | null;
  signature: string;
  folders: Record<string, string>;
  saveSent: boolean;
  notify: boolean;
  preset: boolean;
  error: string | null;
  checkedAt: number | null;
}

export interface AccountsInfo {
  accounts: MailAccount[];
  preset: { name: string; domain: string } | null;
  custom: boolean;
  limit: number;
  email: string;
}

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'flagged' | 'all' | null;

export interface Folder {
  path: string;
  name: string;
  delimiter: string;
  role: FolderRole;
  depth: number;
  messages: number;
  unseen: number;
  selectable: boolean;
}

export interface Address {
  name: string;
  address: string;
}

export interface Summary {
  uid: number;
  subject: string;
  from: Address[];
  to: Address[];
  cc: Address[];
  date: number;
  size: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  forwarded: boolean;
  draft: boolean;
  attachments: boolean;
}

export interface MessageList {
  total: number;
  validity: string;
  items: Summary[];
  more: boolean;
}

export interface Invite {
  method: string;
  uid: string;
  summary: string;
  location: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  organizer: string | null;
}

export interface Message {
  account: string;
  folder: string;
  uid: number;
  subject: string;
  from: Address[];
  sender: Address[];
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: number | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | string[] | null;
  flags: { seen: boolean; flagged: boolean; answered: boolean; draft: boolean };
  size: number;
  html: boolean;
  text: string;
  remote: boolean;
  trusted: boolean;
  attachments: { index: number; name: string; type: string; size: number }[];
  invite: Invite | null;
  unsubscribe: { web: string | null; mail: string | null } | null;
}

export interface Outbox {
  id: string;
  account: string;
  sendAt: number;
  subject: string;
  recipients: string;
  state: 'waiting' | 'sending' | 'failed';
  error: string | null;
}

export type AttachmentRef =
  | { kind: 'node'; node: string; name: string; size: number }
  | { kind: 'message'; folder: string; uid: number; index: number; name: string; size: number }
  | { kind: 'upload'; file: File; name: string; size: number };

export interface ComposeState {
  account: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  text: string;
  inReplyTo: string | null;
  references: string[];
  attachments: AttachmentRef[];
  draft: { folder: string; uid: number } | null;
  answered: { folder: string; uid: number; forward: boolean } | null;
  formatted: boolean;
}

export const base = (account: string) => `/api/mail/accounts/${encodeURIComponent(account)}`;

export const qs = (params: Record<string, string | number | boolean | null | undefined>) =>
  Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');

export const mailApi = {
  accounts: () => api.get<AccountsInfo>('/api/mail/accounts'),
  folders: (account: string) => api.get<{ folders: Folder[] }>(`${base(account)}/folders`),
  messages: (account: string, params: { folder: string; offset?: number; q?: string; filter?: string | null }) =>
    api.get<MessageList>(
      `${base(account)}/messages?${qs({ folder: params.folder, offset: params.offset ?? 0, q: params.q, filter: params.filter })}`
    ),
  message: (account: string, folder: string, uid: number, seen = true) =>
    api.get<{ message: Message }>(`${base(account)}/message?${qs({ folder, uid, seen: seen ? 1 : 0 })}`),
  flags: (account: string, folder: string, uids: number[] | 'all', changes: { seen?: boolean; flagged?: boolean }) =>
    api.post(`${base(account)}/flags`, { folder, uids, ...changes }),
  move: (account: string, folder: string, uids: number[], to: string) => api.post(`${base(account)}/move`, { folder, uids, to }),
  archive: (account: string, folder: string, uids: number[]) => api.post<{ folder: string }>(`${base(account)}/archive`, { folder, uids }),
  remove: (account: string, folder: string, uids: number[]) =>
    api.post<{ result: 'trashed' | 'deleted' }>(`${base(account)}/delete`, { folder, uids }),
  outbox: () => api.get<{ outbox: Outbox[] }>('/api/mail/outbox'),
  cancel: (id: string) => api.delete(`/api/mail/outbox/${encodeURIComponent(id)}`),
  recipients: (q: string) => api.get<{ recipients: (Address & { source: string })[] }>(`/api/mail/recipients?${qs({ q })}`),
};

export const bodyUrl = (account: string, folder: string, uid: number, images: boolean) =>
  `${base(account)}/body?${qs({ folder, uid, images: images ? 1 : 0 })}`;

export const attachmentUrl = (account: string, folder: string, uid: number, index: number) =>
  `${base(account)}/attachment?${qs({ folder, uid, index })}`;

export async function postCompose<T>(url: string, payload: unknown, uploads: File[]): Promise<T> {
  if (!uploads.length) return api.post<T>(url, payload);
  const form = new FormData();
  form.append('payload', JSON.stringify(payload));
  for (const file of uploads) form.append('files', file, file.name);
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken(), Accept: 'application/json' },
    body: form,
  });
  if (!response.ok) {
    let message = t('Da ist etwas schiefgelaufen, versuch es noch einmal');
    try {
      message = String((await response.json()).error?.message ?? message);
    } catch {}
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export const personName = (entry: Address | undefined) => (entry ? entry.name || entry.address : '');

export const initialsOf = (entry: Address | undefined) => {
  const name = personName(entry)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? ''))).toUpperCase();
};

export const formatAddress = (entry: Address) => (entry.name ? `${entry.name} <${entry.address}>` : entry.address);

export function roleLabel(folder: Folder) {
  switch (folder.role) {
    case 'inbox':
      return t('Posteingang');
    case 'sent':
      return t('Gesendet');
    case 'drafts':
      return t('Entwürfe');
    case 'trash':
      return t('Papierkorb');
    case 'junk':
      return t('Spam');
    case 'archive':
      return t('Archiv');
    default:
      return folder.name;
  }
}

const prefixed = (subject: string, prefix: string) =>
  new RegExp(`^${prefix}:`, 'i').test(subject.trim()) ? subject : `${prefix}: ${subject}`;

const quoted = (text: string) =>
  text
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => (line.startsWith('>') ? `>${line}` : `> ${line}`))
    .join('\n');

const referencesOf = (message: Message) => {
  const list = Array.isArray(message.references) ? message.references : message.references ? message.references.split(/\s+/) : [];
  return [...list, ...(message.messageId ? [message.messageId] : [])].filter(Boolean).slice(-20);
};

const signatureBlock = (account: MailAccount | undefined) => (account?.signature.trim() ? `\n\n-- \n${account.signature.trim()}` : '');

const dateLine = (message: Message) =>
  message.date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(message.date)) : '';

export function emptyCompose(account: MailAccount, init: Partial<ComposeState> = {}): ComposeState {
  return {
    account: account.id,
    to: [],
    cc: [],
    bcc: [],
    subject: '',
    text: signatureBlock(account),
    inReplyTo: null,
    references: [],
    attachments: [],
    draft: null,
    answered: null,
    formatted: false,
    ...init,
  };
}

const own = (account: MailAccount) => (entry: Address) => entry.address.toLowerCase() !== account.email.toLowerCase();

export function replyState(account: MailAccount, message: Message, mode: 'reply' | 'all' | 'forward'): ComposeState {
  const sender = message.replyTo.length ? message.replyTo : message.from;
  const intro =
    mode === 'forward'
      ? [
          '',
          '',
          t('---------- Weitergeleitete Nachricht ----------'),
          `${t('Von')}: ${message.from.map(formatAddress).join(', ')}`,
          `${t('Datum')}: ${dateLine(message)}`,
          `${t('Betreff')}: ${message.subject}`,
          `${t('An')}: ${message.to.map(formatAddress).join(', ')}`,
          '',
          message.text,
        ].join('\n')
      : `\n\n${t('Am {date} schrieb {name}:', { date: dateLine(message), name: personName(message.from[0]) })}\n${quoted(message.text)}`;
  const to = mode === 'forward' ? [] : mode === 'all' ? [...sender, ...message.to.filter(own(account))] : sender;
  const unique = (list: Address[]) =>
    list.filter((entry, index) => list.findIndex((other) => other.address.toLowerCase() === entry.address.toLowerCase()) === index);
  return emptyCompose(account, {
    to: unique(to),
    cc: mode === 'all' ? unique(message.cc.filter(own(account))) : [],
    subject: prefixed(message.subject, mode === 'forward' ? 'Fwd' : 'Re'),
    text: mode === 'forward' ? `${signatureBlock(account)}${intro}` : `${signatureBlock(account)}${intro}`,
    inReplyTo: mode === 'forward' ? null : message.messageId,
    references: mode === 'forward' ? [] : referencesOf(message),
    attachments:
      mode === 'forward'
        ? message.attachments.map((entry) => ({
            kind: 'message' as const,
            folder: message.folder,
            uid: message.uid,
            index: entry.index,
            name: entry.name,
            size: entry.size,
          }))
        : [],
    answered: { folder: message.folder, uid: message.uid, forward: mode === 'forward' },
  });
}

export function draftState(account: MailAccount, message: Message): ComposeState {
  return emptyCompose(account, {
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    text: message.text,
    inReplyTo: message.inReplyTo,
    references: referencesOf(message).filter((entry) => entry !== message.messageId),
    attachments: message.attachments.map((entry) => ({
      kind: 'message' as const,
      folder: message.folder,
      uid: message.uid,
      index: entry.index,
      name: entry.name,
      size: entry.size,
    })),
    draft: { folder: message.folder, uid: message.uid },
  });
}

export function composePayload(state: ComposeState, html: string | null, sendAt: number | null) {
  const uploads = state.attachments.filter((entry): entry is Extract<AttachmentRef, { kind: 'upload' }> => entry.kind === 'upload');
  const attachments = state.attachments.map((entry) =>
    entry.kind === 'upload'
      ? { kind: 'upload' as const, index: uploads.indexOf(entry) }
      : entry.kind === 'node'
        ? { kind: 'node' as const, node: entry.node }
        : { kind: 'message' as const, folder: entry.folder, uid: entry.uid, index: entry.index }
  );
  return {
    payload: {
      to: state.to,
      cc: state.cc,
      bcc: state.bcc,
      subject: state.subject,
      text: state.text,
      html,
      inReplyTo: state.inReplyTo,
      references: state.references,
      attachments,
      draft: state.draft,
      answered: state.answered,
      sendAt,
    },
    files: uploads.map((entry) => entry.file),
  };
}

export function parseAddresses(input: string): Address[] {
  return input
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = /^(.*)<([^>]+)>$/.exec(part);
      return match
        ? { name: match[1].trim().replace(/^"|"$/g, ''), address: match[2].trim().toLowerCase() }
        : { name: '', address: part.toLowerCase() };
    })
    .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.address));
}

export function noteText(note: string | null) {
  switch (note) {
    case 'google':
      return t('Google verlangt ein App-Passwort, das du im Google-Konto unter Sicherheit anlegst.');
    case 'microsoft':
      return t('Microsoft lässt bei vielen Konten nur noch die Anmeldung über die eigene Seite zu. Klappt es nicht, liegt es daran.');
    case 'apple':
      return t('Apple verlangt ein app-spezifisches Passwort, das du unter account.apple.com anlegst.');
    case 'yahoo':
      return t('Yahoo verlangt ein App-Passwort aus den Kontoeinstellungen.');
    case 'imap':
      return t('Schalte IMAP vorher in den Einstellungen deines Postfachs ein.');
    case 'telekom':
      return t('Nimm das E-Mail-Passwort aus dem Telekom-Kundencenter, nicht das Login-Passwort.');
    default:
      return null;
  }
}
