import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

interface Message {
  id: number;
  author: 'user' | 'developer' | 'system';
  body: string;
  createdAt: number;
}

interface Ticket {
  id: string;
  number: number;
  subject: string;
  category: string;
  status: 'open' | 'answered' | 'closed';
  createdAt: number;
  updatedAt: number;
  unread: boolean;
  name: string | null;
  email: string | null;
  messages: Message[];
}

export interface PulseNotice {
  id: number;
  level: 'info' | 'warning' | 'security';
  title: string;
  body: string;
  link: string | null;
  minVersion: string | null;
  maxVersion: string | null;
  createdAt: number;
}

export async function pulseSink(version: string) {
  const state = {
    notices: [] as PulseNotice[],
    tickets: [] as Ticket[],
    heartbeats: [] as Record<string, unknown>[],
    events: [] as Record<string, unknown>[],
    forgotten: 0,
  };
  const unread = () => state.tickets.filter((ticket) => ticket.unread).length;
  const summary = (ticket: Ticket) => {
    const { messages, name: _name, email: _email, ...rest } = ticket;
    const last = messages.at(-1)!;
    return { ...rest, last: { author: last.author, body: last.body, createdAt: last.createdAt } };
  };
  const detail = (ticket: Ticket) => ({ ...summary(ticket), name: ticket.name, email: ticket.email, messages: ticket.messages });
  const release = {
    version,
    title: null,
    date: Date.UTC(2026, 10, 24, 12),
    dateText: '24. November 2026',
    url: `https://moecloud.moestudio.net/changelog.html#v${version}`,
    security: false,
    channel: 'stable',
    notes: '### Neu\n\n- Hilfe direkt in der Verwaltung\n- Fragen mit Datei-Upload in Formularen',
  };

  function answer(path: string, query: URLSearchParams, body: Record<string, unknown>): [number, unknown] {
    const now = Date.now();
    if (path === '/v1/updates/moecloud') {
      return [
        200,
        {
          ok: true,
          app: 'moecloud',
          version: query.get('version'),
          channel: 'stable',
          latest: release,
          update: query.get('version') !== version,
          security: false,
          yanked: false,
          behind: 0,
          releases: [],
          checkedAt: now,
        },
      ];
    }
    if (path === '/v1/notices/moecloud') return [200, { ok: true, notices: state.notices }];
    if (path === '/v1/heartbeat') {
      state.heartbeats.push(body);
      return [200, { ok: true, interval: 21_600, errors: true, now, support: { unread: unread() }, notices: state.notices }];
    }
    if (path === '/v1/events') {
      state.events.push(body);
      return [200, { ok: true, accepted: Array.isArray(body.events) ? body.events.length : 0 }];
    }
    if (path === '/v1/forget') {
      state.forgotten++;
      state.tickets = [];
      return [200, { ok: true }];
    }
    if (path === '/v1/tickets/create') {
      const ticket: Ticket = {
        id: `ticket-${state.tickets.length + 1}`,
        number: 1040 + state.tickets.length + 1,
        subject: String(body.subject),
        category: String(body.category),
        status: 'open',
        createdAt: now,
        updatedAt: now,
        unread: false,
        name: typeof body.name === 'string' ? body.name : null,
        email: typeof body.email === 'string' ? body.email : null,
        messages: [{ id: 1, author: 'user', body: String(body.message), createdAt: now }],
      };
      state.tickets.unshift(ticket);
      return [200, { ok: true, ticket: detail(ticket), support: { unread: unread() } }];
    }
    if (path === '/v1/tickets/list') return [200, { ok: true, tickets: state.tickets.map(summary), support: { unread: unread() } }];
    const ticket = state.tickets.find((entry) => entry.id === body.id);
    if (!ticket) return [404, { ok: false, error: 'not_found' }];
    if (path === '/v1/tickets/get') ticket.unread = false;
    else if (path === '/v1/tickets/reply') {
      ticket.messages.push({ id: ticket.messages.length + 1, author: 'user', body: String(body.message), createdAt: now });
      ticket.status = 'open';
      ticket.updatedAt = now;
    } else if (path === '/v1/tickets/close') ticket.status = 'closed';
    else return [404, { ok: false, error: 'not_found' }];
    return [200, { ok: true, ticket: detail(ticket), support: { unread: unread() } }];
  }

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      let body: Record<string, unknown> = {};
      try {
        body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
      } catch {}
      const [status, reply] = answer(url.pathname, url.searchParams, body);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    state,
    reply(number: number, text: string) {
      const ticket = state.tickets.find((entry) => entry.number === number)!;
      ticket.messages.push({ id: ticket.messages.length + 1, author: 'developer', body: text, createdAt: Date.now() });
      ticket.status = 'answered';
      ticket.unread = true;
      ticket.updatedAt = Date.now();
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
