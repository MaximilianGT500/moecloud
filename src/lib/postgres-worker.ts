import { workerData, type MessagePort } from 'node:worker_threads';
import pg from 'pg';

interface Request {
  kind: 'connect' | 'query' | 'exec' | 'close';
  text?: string;
  values?: unknown[];
}

const { url, port, signal } = workerData as { url: string; port: MessagePort; signal: Int32Array };

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

let client: pg.Client | null = null;

async function connection() {
  if (client) return client;
  const fresh = new pg.Client({ connectionString: url, application_name: 'moecloud' });
  fresh.on('error', () => {
    if (client === fresh) client = null;
  });
  await fresh.connect();
  await fresh.query("SET client_min_messages = 'warning'");
  client = fresh;
  return fresh;
}

async function handle(request: Request) {
  if (request.kind === 'close') {
    const open = client;
    client = null;
    await open?.end();
    return null;
  }
  const db = await connection();
  if (request.kind === 'connect') return (await db.query('SHOW server_version')).rows[0].server_version as string;
  if (request.kind === 'exec') {
    await db.query(request.text!);
    return null;
  }
  const result = await db.query(request.text!, request.values);
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
}

port.on('message', async (request: Request) => {
  let reply: unknown;
  try {
    reply = { result: await handle(request) };
  } catch (error) {
    const failure = error as { message?: string; code?: string; detail?: string };
    reply = { error: { message: failure.message ?? String(error), code: failure.code, detail: failure.detail } };
  }
  port.postMessage(reply);
  Atomics.store(signal, 0, 1);
  Atomics.notify(signal, 0);
});
