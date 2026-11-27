import { createServer, type AddressInfo, type Socket } from 'node:net';

export interface StoredMessage {
  uid: number;
  flags: Set<string>;
  raw: Buffer;
  date: Date;
}

export interface Box {
  name: string;
  special: string | null;
  validity: number;
  next: number;
  messages: StoredMessage[];
}

type Token = string | null | Token[] | { literal: Buffer };

const CAPABILITIES = 'IMAP4rev1 LITERAL+ UIDPLUS MOVE SPECIAL-USE AUTH=PLAIN SASL-IR';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function quote(value: string | null | undefined) {
  if (value === null || value === undefined) return 'NIL';
  if (/[\r\n]/.test(value) || /[^\x20-\x7e]/.test(value)) {
    const data = Buffer.from(value, 'utf8');
    return `{${data.length}}\r\n${data.toString('latin1')}`;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function headerBlock(raw: Buffer) {
  const text = raw.toString('latin1');
  const end = text.search(/\r?\n\r?\n/);
  return end === -1 ? text : text.slice(0, end);
}

function headers(raw: Buffer) {
  const map = new Map<string, string[]>();
  const unfolded = headerBlock(raw).replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const list = map.get(key) ?? [];
    list.push(line.slice(index + 1).trim());
    map.set(key, list);
  }
  return map;
}

function splitAddresses(value: string) {
  const out: { name: string; mailbox: string; host: string }[] = [];
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const char of value) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '<') depth++;
    if (!quoted && char === '>') depth--;
    if (!quoted && depth === 0 && char === ',') {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  for (const part of parts) {
    const angle = /^(.*)<([^>]+)>\s*$/.exec(part.trim());
    const address = (angle ? angle[2] : part).trim();
    const name = angle ? angle[1].trim().replace(/^"|"$/g, '') : '';
    const [mailbox, host] = address.split('@');
    if (mailbox) out.push({ name, mailbox, host: host ?? '' });
  }
  return out;
}

function addressList(value: string | undefined) {
  if (!value) return 'NIL';
  const list = splitAddresses(value);
  if (!list.length) return 'NIL';
  return `(${list.map((entry) => `(${entry.name ? quote(entry.name) : 'NIL'} NIL ${quote(entry.mailbox)} ${quote(entry.host)})`).join('')})`;
}

function envelope(raw: Buffer) {
  const map = headers(raw);
  const one = (key: string) => map.get(key)?.[0];
  const from = addressList(one('from'));
  return `(${quote(one('date') ?? null)} ${quote(one('subject') ?? null)} ${from} ${one('sender') ? addressList(one('sender')) : from} ${
    one('reply-to') ? addressList(one('reply-to')) : from
  } ${addressList(one('to'))} ${addressList(one('cc'))} ${addressList(one('bcc'))} ${quote(one('in-reply-to') ?? null)} ${quote(one('message-id') ?? null)})`;
}

function internalDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `"${pad(date.getUTCDate())}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds()
  )} +0000"`;
}

function parseSet(set: string, max: number) {
  const values = new Set<number>();
  for (const part of set.split(',')) {
    const [a, b] = part.split(':');
    const start = a === '*' ? max : Number(a);
    const end = b === undefined ? start : b === '*' ? max : Number(b);
    const low = Math.min(start, end);
    const high = Math.max(start, end);
    for (let value = low; value <= high && value - low < 100_000; value++) values.add(value);
  }
  return values;
}

function tokenize(input: Buffer, start: number): { tokens: Token[]; end: number; need: number | null; plus: boolean } {
  const stack: Token[][] = [[]];
  let at = start;
  while (at < input.length) {
    const char = String.fromCharCode(input[at]);
    if (char === '\r' && input[at + 1] === 0x0a) return { tokens: stack[0], end: at + 2, need: null, plus: false };
    if (char === ' ') {
      at++;
      continue;
    }
    if (char === '(' || char === '[') {
      const list: Token[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      at++;
      continue;
    }
    if (char === ')' || char === ']') {
      stack.pop();
      at++;
      continue;
    }
    if (char === '"') {
      let value = '';
      at++;
      while (at < input.length && input[at] !== 0x22) {
        if (input[at] === 0x5c) at++;
        value += String.fromCharCode(input[at]);
        at++;
      }
      at++;
      stack[stack.length - 1].push(Buffer.from(value, 'latin1').toString('utf8'));
      continue;
    }
    if (char === '{') {
      const close = input.indexOf('}', at);
      const spec = input.subarray(at + 1, close).toString('latin1');
      const plus = spec.endsWith('+');
      const size = Number.parseInt(spec, 10);
      const dataStart = close + 3;
      if (input.length < dataStart + size) return { tokens: stack[0], end: at, need: size, plus };
      stack[stack.length - 1].push({ literal: input.subarray(dataStart, dataStart + size) });
      at = dataStart + size;
      continue;
    }
    let atom = '';
    while (at < input.length && !' ()[]\r'.includes(String.fromCharCode(input[at]))) {
      atom += String.fromCharCode(input[at]);
      at++;
    }
    if (atom.endsWith('<') || /BODY(\.PEEK)?$/i.test(atom) || /BINARY(\.PEEK)?$/i.test(atom)) {
      const close = input.indexOf(']', at);
      if (input[at] === 0x5b && close !== -1) {
        let end = close + 1;
        if (input[end] === 0x3c) end = input.indexOf('>', end) + 1;
        atom += input.subarray(at, end).toString('latin1');
        at = end;
      }
    }
    stack[stack.length - 1].push(atom.toUpperCase() === 'NIL' ? null : atom);
  }
  return { tokens: stack[0], end: -1, need: null, plus: false };
}

const text = (token: Token | undefined): string =>
  token === null || token === undefined
    ? ''
    : typeof token === 'string'
      ? token
      : Array.isArray(token)
        ? ''
        : token.literal.toString('utf8');

export async function imapSink(options: { user: string; pass: string }) {
  const boxes = new Map<string, Box>();
  const commands: string[] = [];
  let validity = 1000;
  const box = (name: string, special: string | null = null) => {
    const created: Box = { name, special, validity: validity++, next: 1, messages: [] };
    boxes.set(name, created);
    return created;
  };
  box('INBOX');
  box('Drafts', '\\Drafts');
  box('Sent', '\\Sent');
  box('Trash', '\\Trash');
  box('Junk', '\\Junk');

  const add = (name: string, raw: Buffer | string, flags: string[] = [], date = new Date()) => {
    const target = boxes.get(name) ?? box(name);
    const message: StoredMessage = { uid: target.next++, flags: new Set(flags), raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw), date };
    target.messages.push(message);
    return message;
  };

  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buffer = Buffer.alloc(0);
    let authenticated = false;
    let selected: Box | null = null;
    let readOnly = false;
    let pendingAuth: string | null = null;
    const write = (line: string) => socket.write(Buffer.from(`${line}\r\n`, 'latin1'));

    const fetchItems = (message: StoredMessage, seq: number, items: Token[], uidMode: boolean) => {
      const parts: string[] = [];
      const wanted = items.flatMap((item) => (Array.isArray(item) ? item : [item])).map((item) => text(item).toUpperCase());
      if (uidMode || wanted.includes('UID')) parts.push(`UID ${message.uid}`);
      let seen = false;
      for (const item of wanted) {
        if (item === 'UID') continue;
        if (item === 'FLAGS') parts.push(`FLAGS (${[...message.flags].join(' ')})`);
        else if (item === 'ENVELOPE') parts.push(`ENVELOPE ${envelope(message.raw)}`);
        else if (item === 'INTERNALDATE') parts.push(`INTERNALDATE ${internalDate(message.date)}`);
        else if (item === 'RFC822.SIZE') parts.push(`RFC822.SIZE ${message.raw.length}`);
        else if (item.startsWith('BODY.PEEK[HEADER.FIELDS') || item.startsWith('BODY[HEADER.FIELDS')) {
          const fields =
            /\(([^)]*)\)/
              .exec(item)?.[1]
              .split(/\s+/)
              .map((field) => field.toLowerCase()) ?? [];
          const lines = headerBlock(message.raw)
            .replace(/\r?\n([ \t])/g, '\u0000$1')
            .split(/\r?\n/)
            .filter((line) => fields.includes(line.slice(0, line.indexOf(':')).trim().toLowerCase()))
            .map((line) => line.replace(/\u0000/g, '\r\n'));
          const data = Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'latin1');
          parts.push(
            `BODY[HEADER.FIELDS (${fields.map((field) => field.toUpperCase()).join(' ')})] {${data.length}}\r\n${data.toString('latin1')}`
          );
        } else if (item === 'BODY.PEEK[]' || item === 'BODY[]' || item === 'RFC822' || item === 'BINARY.PEEK[]') {
          if (item === 'BODY[]' || item === 'RFC822') seen = true;
          const label = item === 'RFC822' ? 'RFC822' : item.startsWith('BINARY') ? 'BINARY[]' : 'BODY[]';
          parts.push(`${label} {${message.raw.length}}\r\n${message.raw.toString('latin1')}`);
        } else if (item === 'BODY.PEEK[HEADER]' || item === 'BODY[HEADER]') {
          const data = Buffer.from(`${headerBlock(message.raw)}\r\n\r\n`, 'latin1');
          parts.push(`BODY[HEADER] {${data.length}}\r\n${data.toString('latin1')}`);
        }
      }
      if (seen && !readOnly && !message.flags.has('\\Seen')) {
        message.flags.add('\\Seen');
        parts.push(`FLAGS (${[...message.flags].join(' ')})`);
      }
      socket.write(Buffer.from(`* ${seq} FETCH (${parts.join(' ')})\r\n`, 'latin1'));
    };

    const matches = (message: StoredMessage, criteria: Token[], all: StoredMessage[]): boolean => {
      for (let index = 0; index < criteria.length; index++) {
        const key = text(criteria[index]).toUpperCase();
        if (Array.isArray(criteria[index])) {
          if (!matches(message, criteria[index] as Token[], all)) return false;
          continue;
        }
        if (key === 'ALL') continue;
        if (key === 'SEEN' && !message.flags.has('\\Seen')) return false;
        if (key === 'UNSEEN' && message.flags.has('\\Seen')) return false;
        if (key === 'FLAGGED' && !message.flags.has('\\Flagged')) return false;
        if (key === 'UNFLAGGED' && message.flags.has('\\Flagged')) return false;
        if (key === 'DELETED' && !message.flags.has('\\Deleted')) return false;
        if (key === 'UNDELETED' && message.flags.has('\\Deleted')) return false;
        if (key === 'UID') {
          const set = parseSet(text(criteria[++index]), Math.max(0, ...all.map((entry) => entry.uid)));
          if (!set.has(message.uid)) return false;
        }
        if (key === 'TEXT' || key === 'BODY' || key === 'SUBJECT' || key === 'FROM' || key === 'TO') {
          const needle = text(criteria[++index]).toLowerCase();
          const haystack =
            key === 'SUBJECT' || key === 'FROM' || key === 'TO'
              ? (headers(message.raw).get(key.toLowerCase())?.join(' ') ?? '')
              : message.raw.toString('utf8');
          if (!haystack.toLowerCase().includes(needle)) return false;
        }
        if (key === 'HEADER') {
          const field = text(criteria[++index]).toLowerCase();
          const needle = text(criteria[++index]).toLowerCase();
          if (!(headers(message.raw).get(field) ?? []).some((value) => value.toLowerCase().includes(needle))) return false;
        }
        if (key === 'OR') {
          const left = criteria[++index];
          const right = criteria[++index];
          if (!matches(message, Array.isArray(left) ? left : [left], all) && !matches(message, Array.isArray(right) ? right : [right], all))
            return false;
        }
        if (/^\d|^\*/.test(key)) {
          const set = parseSet(key, all.length);
          if (!set.has(all.indexOf(message) + 1)) return false;
        }
      }
      return true;
    };

    const expunge = (target: Box, uids?: Set<number>) => {
      for (let index = target.messages.length - 1; index >= 0; index--) {
        const message = target.messages[index];
        if (message.flags.has('\\Deleted') && (!uids || uids.has(message.uid))) {
          target.messages.splice(index, 1);
          if (target === selected) write(`* ${index + 1} EXPUNGE`);
        }
      }
    };

    const handle = (tag: string, tokens: Token[]) => {
      let command = text(tokens[0]).toUpperCase();
      let args = tokens.slice(1);
      let uidMode = false;
      if (command === 'UID') {
        uidMode = true;
        command = text(args[0]).toUpperCase();
        args = args.slice(1);
      }
      commands.push(`${uidMode ? 'UID ' : ''}${command}`);
      const ok = (message = 'Done') => write(`${tag} OK ${message}`);
      if (command === 'CAPABILITY') {
        write(`* CAPABILITY ${CAPABILITIES}`);
        return ok();
      }
      if (command === 'NOOP' || command === 'CHECK') return ok();
      if (command === 'LOGOUT') {
        write('* BYE Bis bald');
        ok();
        socket.end();
        return;
      }
      if (command === 'ID') {
        write('* ID NIL');
        return ok();
      }
      if (command === 'LOGIN') {
        if (text(args[0]) === options.user && text(args[1]) === options.pass) {
          authenticated = true;
          return ok(`[CAPABILITY ${CAPABILITIES}] Logged in`);
        }
        return write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
      }
      if (command === 'AUTHENTICATE') {
        const initial = text(args[1]);
        const check = (encoded: string) => {
          const [, user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split('\u0000');
          if (user === options.user && pass === options.pass) {
            authenticated = true;
            ok('Logged in');
          } else write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
        };
        if (initial) return check(initial);
        pendingAuth = tag;
        write('+ ');
        return;
      }
      if (!authenticated) return write(`${tag} NO Please log in first`);
      if (command === 'NAMESPACE') {
        write('* NAMESPACE (("" "/")) NIL NIL');
        return ok();
      }
      if (command === 'ENABLE') return ok();
      if (command === 'LIST' || command === 'LSUB' || command === 'XLIST') {
        const pattern = text(args.find((arg, index) => index > 0 && !Array.isArray(arg)) ?? '*');
        if (pattern === '') {
          write(`* ${command} (\\Noselect) "/" ""`);
          return ok();
        }
        const matcher = new RegExp(
          `^${pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/%/g, '[^/]*')}$`,
          'i'
        );
        for (const entry of boxes.values()) {
          if (!matcher.test(entry.name)) continue;
          const flags = ['\\HasNoChildren', ...(entry.special ? [entry.special] : [])];
          write(`* ${command} (${flags.join(' ')}) "/" ${quote(entry.name)}`);
        }
        return ok();
      }
      if (command === 'STATUS') {
        const target = boxes.get(text(args[0]));
        if (!target) return write(`${tag} NO [NONEXISTENT] Unknown mailbox`);
        const unseen = target.messages.filter((message) => !message.flags.has('\\Seen')).length;
        write(
          `* STATUS ${quote(target.name)} (MESSAGES ${target.messages.length} UNSEEN ${unseen} UIDNEXT ${target.next} UIDVALIDITY ${target.validity})`
        );
        return ok();
      }
      if (command === 'SELECT' || command === 'EXAMINE') {
        const target = boxes.get(text(args[0]));
        if (!target) return write(`${tag} NO [NONEXISTENT] Unknown mailbox`);
        selected = target;
        readOnly = command === 'EXAMINE';
        write('* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft $Forwarded)');
        write('* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft $Forwarded \\*)] Limited');
        write(`* ${target.messages.length} EXISTS`);
        write('* 0 RECENT');
        write(`* OK [UIDVALIDITY ${target.validity}] UIDs valid`);
        write(`* OK [UIDNEXT ${target.next}] Predicted next UID`);
        return ok(`[${readOnly ? 'READ-ONLY' : 'READ-WRITE'}] ${command} completed`);
      }
      if (command === 'CLOSE' || command === 'UNSELECT') {
        if (command === 'CLOSE' && selected && !readOnly) expunge(selected);
        selected = null;
        return ok();
      }
      if (command === 'CREATE') {
        const name = text(args[0]);
        if (boxes.has(name)) return write(`${tag} NO [ALREADYEXISTS] Mailbox exists`);
        box(name);
        return ok();
      }
      if (command === 'DELETE') {
        if (!boxes.delete(text(args[0]))) return write(`${tag} NO [NONEXISTENT] Unknown mailbox`);
        return ok();
      }
      if (command === 'RENAME') {
        const source = boxes.get(text(args[0]));
        if (!source) return write(`${tag} NO [NONEXISTENT] Unknown mailbox`);
        boxes.delete(source.name);
        source.name = text(args[1]);
        boxes.set(source.name, source);
        return ok();
      }
      if (command === 'SUBSCRIBE' || command === 'UNSUBSCRIBE') return ok();
      if (command === 'APPEND') {
        const target = boxes.get(text(args[0]));
        if (!target) return write(`${tag} NO [TRYCREATE] Unknown mailbox`);
        const flags = (args.find(Array.isArray) as Token[] | undefined)?.map((flag) => text(flag)) ?? [];
        const literal = args.find((arg) => arg !== null && typeof arg === 'object' && !Array.isArray(arg)) as
          { literal: Buffer } | undefined;
        if (!literal) return write(`${tag} BAD Missing message`);
        const message = add(target.name, Buffer.from(literal.literal), flags);
        return ok(`[APPENDUID ${target.validity} ${message.uid}] APPEND completed`);
      }
      if (!selected) return write(`${tag} NO No mailbox selected`);
      const current = selected;
      const pick = (set: string) => {
        if (uidMode) {
          const wanted = parseSet(set, Math.max(0, ...current.messages.map((message) => message.uid)));
          return current.messages.map((message, index) => ({ message, seq: index + 1 })).filter((entry) => wanted.has(entry.message.uid));
        }
        const wanted = parseSet(set, current.messages.length);
        return current.messages.map((message, index) => ({ message, seq: index + 1 })).filter((entry) => wanted.has(entry.seq));
      };
      if (command === 'FETCH') {
        const items = Array.isArray(args[1]) ? args[1] : [args[1]];
        for (const entry of pick(text(args[0]))) fetchItems(entry.message, entry.seq, items, uidMode);
        return ok();
      }
      if (command === 'SEARCH') {
        const criteria = args.filter((arg) => !(typeof arg === 'string' && /^CHARSET$/i.test(arg)));
        const filtered = criteria[0] && /^CHARSET$/i.test(text(args[0])) ? criteria.slice(1) : criteria;
        const found = current.messages.filter((message) => matches(message, filtered, current.messages));
        write(`* SEARCH${found.map((message) => ` ${uidMode ? message.uid : current.messages.indexOf(message) + 1}`).join('')}`);
        return ok();
      }
      if (command === 'STORE') {
        const mode = text(args[1]).toUpperCase();
        const flags = (Array.isArray(args[2]) ? args[2] : [args[2]]).map((flag) => text(flag));
        for (const entry of pick(text(args[0]))) {
          if (mode.startsWith('+')) for (const flag of flags) entry.message.flags.add(flag);
          else if (mode.startsWith('-')) for (const flag of flags) entry.message.flags.delete(flag);
          else entry.message.flags = new Set(flags);
          if (!mode.endsWith('.SILENT'))
            write(`* ${entry.seq} FETCH (UID ${entry.message.uid} FLAGS (${[...entry.message.flags].join(' ')}))`);
        }
        return ok();
      }
      if (command === 'COPY' || command === 'MOVE') {
        const target = boxes.get(text(args[1]));
        if (!target) return write(`${tag} NO [TRYCREATE] Unknown mailbox`);
        const entries = pick(text(args[0]));
        const copied = entries.map((entry) =>
          add(
            target.name,
            Buffer.from(entry.message.raw),
            [...entry.message.flags].filter((flag) => flag !== '\\Deleted'),
            entry.message.date
          )
        );
        const code = `[COPYUID ${target.validity} ${entries.map((entry) => entry.message.uid).join(',')} ${copied.map((message) => message.uid).join(',')}]`;
        if (command === 'MOVE') {
          write(`* OK ${code} Moved`);
          for (const entry of [...entries].sort((a, b) => b.seq - a.seq)) {
            const index = current.messages.indexOf(entry.message);
            current.messages.splice(index, 1);
            write(`* ${index + 1} EXPUNGE`);
          }
          return ok('Move completed');
        }
        return ok(`${code} Copy completed`);
      }
      if (command === 'EXPUNGE') {
        expunge(current, uidMode ? parseSet(text(args[0]), Math.max(0, ...current.messages.map((message) => message.uid))) : undefined);
        return ok();
      }
      write(`${tag} BAD Unknown command ${command}`);
    };

    write(`* OK [CAPABILITY ${CAPABILITIES}] MoeTest IMAP ready`);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (pendingAuth) {
          const end = buffer.indexOf('\r\n');
          if (end === -1) return;
          const line = buffer.subarray(0, end).toString('latin1');
          buffer = buffer.subarray(end + 2);
          const tag = pendingAuth;
          pendingAuth = null;
          const [, user, pass] = Buffer.from(line, 'base64').toString('utf8').split('\u0000');
          if (user === options.user && pass === options.pass) {
            authenticated = true;
            write(`${tag} OK Logged in`);
          } else write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
          continue;
        }
        const space = buffer.indexOf(' ');
        const firstLine = buffer.indexOf('\r\n');
        if (firstLine === -1) return;
        const parsed = tokenize(buffer, space === -1 || space > firstLine ? firstLine : space + 1);
        if (parsed.need !== null) {
          if (!parsed.plus) {
            const marker = `{${parsed.need}}\r\n`;
            const index = buffer.indexOf(marker);
            if (index !== -1 && buffer.length === index + marker.length) write('+ Ready');
          }
          return;
        }
        if (parsed.end === -1) return;
        const tag = buffer.subarray(0, space).toString('latin1');
        buffer = buffer.subarray(parsed.end);
        try {
          handle(tag, parsed.tokens);
        } catch (error) {
          write(`${tag} BAD ${(error as Error).message}`);
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    boxes,
    commands,
    add,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
