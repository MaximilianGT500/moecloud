import { createReadStream } from 'node:fs';
import { createConnection, type Socket } from 'node:net';

export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

const CHUNK = 64 * 1024;

export interface ClamTarget {
  host: string;
  port: number;
  socket: string | null;
  timeoutMs: number;
}

export interface ScanResult {
  infected: boolean;
  signature: string | null;
}

export class ClamError extends Error {
  code: 'unreachable' | 'too_large' | 'error';

  constructor(message: string, code: 'unreachable' | 'too_large' | 'error') {
    super(message);
    this.code = code;
  }
}

function connect(target: ClamTarget): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = target.socket ? createConnection({ path: target.socket }) : createConnection({ host: target.host, port: target.port });
    const fail = (error: Error) => {
      socket.destroy();
      reject(new ClamError(error.message || 'ClamAV ist nicht erreichbar', 'unreachable'));
    };
    socket.setTimeout(target.timeoutMs);
    socket.once('connect', () => {
      socket.off('error', fail);
      resolve(socket);
    });
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('ClamAV antwortet nicht')));
  });
}

function collect(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let failure: Error | null = null;
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', (error) => {
      failure = error;
    });
    socket.on('timeout', () => socket.destroy(new Error('ClamAV antwortet nicht')));
    socket.on('close', () => {
      const text = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
      if (text) resolve(text);
      else reject(new ClamError(failure?.message || 'ClamAV hat ohne Antwort aufgelegt', 'unreachable'));
    });
  });
}

function write(socket: Socket, buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed || socket.writableEnded) {
      reject(new Error('closed'));
      return;
    }
    if (socket.write(buffer, (error) => error && reject(error))) {
      resolve();
      return;
    }
    const done = () => {
      socket.off('drain', done);
      socket.off('close', done);
      resolve();
    };
    socket.once('drain', done);
    socket.once('close', done);
  });
}

export function parseReply(text: string): ScanResult {
  const line = text.split('\n')[0].trim();
  const found = /^(?:stream|[^:]*):\s*(.+?)\s+FOUND$/.exec(line);
  if (found) return { infected: true, signature: found[1] };
  if (/:\s*OK$/.test(line)) return { infected: false, signature: null };
  if (/size limit/i.test(line)) throw new ClamError(line, 'too_large');
  throw new ClamError(line.replace(/\s*ERROR$/, '') || 'Unbekannte Antwort von ClamAV', 'error');
}

export async function scanStream(source: AsyncIterable<Buffer>, target: ClamTarget): Promise<ScanResult> {
  const socket = await connect(target);
  const answer = collect(socket);
  try {
    await write(socket, Buffer.from('zINSTREAM\0'));
    for await (const chunk of source) {
      for (let offset = 0; offset < chunk.length; offset += CHUNK) {
        const part = chunk.subarray(offset, offset + CHUNK);
        const header = Buffer.alloc(4);
        header.writeUInt32BE(part.length);
        await write(socket, Buffer.concat([header, part]));
      }
    }
    await write(socket, Buffer.alloc(4));
    socket.end();
  } catch {
    socket.end();
  }
  return parseReply(await answer);
}

export const scanFile = (path: string, target: ClamTarget) => scanStream(createReadStream(path, { highWaterMark: CHUNK * 4 }), target);

export const scanBuffer = (buffer: Buffer, target: ClamTarget) =>
  scanStream(
    (async function* () {
      yield buffer;
    })(),
    target
  );

export async function clamVersion(target: ClamTarget): Promise<string> {
  const socket = await connect(target);
  const answer = collect(socket);
  socket.end('zVERSION\0');
  return answer;
}
