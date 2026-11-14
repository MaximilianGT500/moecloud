import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';

const TIMEOUT = 120_000;

export interface PostgresResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface Reply {
  result?: unknown;
  error?: { message: string; code?: string; detail?: string };
}

export class PostgresError extends Error {
  code?: string;
  detail?: string;
}

export const isPostgresUrl = (value: string) => /^postgres(?:ql)?:\/\//i.test(value);

export function redactUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return 'postgres://…';
  }
}

export class Postgres {
  readonly version: string;
  private readonly worker: Worker;
  private readonly port: MessagePort;
  private readonly signal = new Int32Array(new SharedArrayBuffer(4));
  private closed = false;

  constructor(url: string) {
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.worker = new Worker(new URL('./postgres-worker.ts', import.meta.url), {
      workerData: { url, port: channel.port2, signal: this.signal },
      transferList: [channel.port2],
    });
    this.worker.unref();
    try {
      this.version = this.request({ kind: 'connect' }) as string;
    } catch (error) {
      void this.worker.terminate();
      throw error;
    }
  }

  private request(message: Record<string, unknown>): unknown {
    if (this.closed) throw new Error('Die Verbindung zu PostgreSQL ist geschlossen');
    Atomics.store(this.signal, 0, 0);
    this.port.postMessage(message);
    if (Atomics.wait(this.signal, 0, 0, TIMEOUT) === 'timed-out') {
      throw new Error(`PostgreSQL hat nach ${TIMEOUT / 1000} Sekunden nicht geantwortet`);
    }
    const reply = receiveMessageOnPort(this.port)?.message as Reply | undefined;
    if (!reply) throw new Error('PostgreSQL hat keine Antwort geschickt');
    if (reply.error) {
      const error = new PostgresError(reply.error.message);
      error.code = reply.error.code;
      error.detail = reply.error.detail;
      throw error;
    }
    return reply.result;
  }

  query(text: string, values: unknown[] = []) {
    return this.request({ kind: 'query', text, values }) as PostgresResult;
  }

  exec(text: string) {
    this.request({ kind: 'exec', text });
  }

  close() {
    if (this.closed) return;
    try {
      this.request({ kind: 'close' });
    } finally {
      this.closed = true;
      this.port.close();
      void this.worker.terminate();
    }
  }
}
