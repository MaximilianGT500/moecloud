import { MessageChannel, receiveMessageOnPort, Worker } from 'node:worker_threads';

export interface CopyResult {
  tables: Record<string, number>;
  rows: number;
  seconds: number;
}

type Message =
  { kind: 'progress'; table: string; rows: number } | { kind: 'done'; result: CopyResult } | { kind: 'error'; message: string };

const script = new URL('./copy-worker.ts', import.meta.url);

export function copyDatabase(from: string, to: string, onProgress?: (table: string, rows: number) => void) {
  return new Promise<CopyResult>((resolve, reject) => {
    const worker = new Worker(script, { workerData: { from, to } });
    let settled = false;
    worker.on('message', (message: Message) => {
      if (message.kind === 'progress') onProgress?.(message.table, message.rows);
      else {
        settled = true;
        if (message.kind === 'done') resolve(message.result);
        else reject(new Error(message.message));
        void worker.terminate();
      }
    });
    worker.on('error', (error) => {
      settled = true;
      reject(error);
    });
    worker.on('exit', (code) => {
      if (!settled) reject(new Error(`Das Kopieren der Datenbank ist abgebrochen (Code ${code})`));
    });
  });
}

export function copyDatabaseSync(from: string, to: string): CopyResult {
  const signal = new Int32Array(new SharedArrayBuffer(8));
  const channel = new MessageChannel();
  const worker = new Worker(script, { workerData: { from, to, port: channel.port2, signal }, transferList: [channel.port2] });
  try {
    let beat = Atomics.load(signal, 1);
    let quiet = 0;
    while (Atomics.load(signal, 0) === 0) {
      Atomics.wait(signal, 0, 0, 5000);
      const now = Atomics.load(signal, 1);
      quiet = now === beat ? quiet + 5 : 0;
      beat = now;
      if (quiet >= 60 && Atomics.load(signal, 0) === 0) throw new Error('Das Kopieren der Datenbank antwortet nicht mehr');
    }
    for (;;) {
      const message = receiveMessageOnPort(channel.port1)?.message as Message | undefined;
      if (!message) throw new Error('Das Kopieren der Datenbank hat kein Ergebnis geliefert');
      if (message.kind === 'done') return message.result;
      if (message.kind === 'error') throw new Error(message.message);
    }
  } finally {
    channel.port1.close();
    void worker.terminate();
  }
}
