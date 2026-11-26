import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { config } from '../src/config.ts';
import { all, one } from '../src/lib/db.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let miaId = 0;
let address = 0;

interface Form {
  id: string;
  url: string;
}

type Part = { name: string; value: string } | { name: string; filename: string; content: Buffer | string };

function multipart(parts: Part[]) {
  const boundary = `----moe${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const head =
      'filename' in part
        ? `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
        : `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n`;
    chunks.push(Buffer.from(head), Buffer.from('filename' in part ? part.content : part.value), Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

async function newForm(client: Client, title: string, questions: unknown[]) {
  const made = await client.json('POST', '/api/forms', { title });
  assert.equal(made.statusCode, 200, made.body);
  const saved = await client.json('PATCH', `/api/forms/${made.json().form.id}`, { questions });
  assert.equal(saved.statusCode, 200, saved.body);
  return saved.json().form as Form;
}

async function send(url: string, parts: Part[]) {
  const client = new Client(app);
  const remoteAddress = `127.0.7.${(address++ % 250) + 1}`;
  const page = await client.send({ method: 'GET', url, headers: { accept: 'text/html' }, remoteAddress });
  assert.equal(page.statusCode, 200, page.body);
  const csrf = client.cookies.get('moe_csrf') ?? client.csrf;
  const { body, type } = multipart([{ name: '_csrf', value: csrf }, ...parts]);
  const response = await client.send({
    method: 'POST',
    url,
    remoteAddress,
    headers: { 'content-type': type, accept: 'text/html' },
    payload: body,
  });
  return { page, response };
}

const tmpFiles = async () => (await readdir(config.paths.tmp)).length;

const QUESTIONS = [
  { id: 'name', kind: 'text', title: 'Wie heißt du?', required: true },
  { id: 'beleg', kind: 'file', title: 'Dein Beleg', required: true, max: 1, accept: '.PDF, txt; exe!' },
  { id: 'extra', kind: 'file', title: 'Noch etwas?', required: false },
];

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' });
  miaId = made.json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
});

after(() => app.close());

describe('Formulare mit Datei-Fragen', () => {
  it('speichert die Einstellungen der Frage bereinigt', async () => {
    const form = await newForm(emi, 'Belege', QUESTIONS);
    const saved = (await emi.get(`/api/forms/${form.id}`)).json().form.questions as { id: string; max: number; accept: string }[];
    const beleg = saved.find((entry) => entry.id === 'beleg')!;
    assert.equal(beleg.max, 1);
    assert.equal(beleg.accept, 'pdf, txt');
    assert.equal(saved.find((entry) => entry.id === 'extra')!.max, 10);
    const many = Array.from({ length: 21 }, (_, index) => ({ id: `f${index}`, kind: 'file', title: `Datei ${index}` }));
    const refused = await emi.json('PATCH', `/api/forms/${form.id}`, { questions: many });
    assert.equal(refused.statusCode, 400);
  });

  it('legt hochgeladene Dateien beim Formular ab und verlinkt sie', async () => {
    const form = await newForm(emi, 'Reise/Kosten', QUESTIONS);
    const before = await tmpFiles();
    const { page, response } = await send(form.url, [
      { name: 'q-name', value: 'Lea' },
      { name: 'q-beleg', filename: 'Quittung Lea.txt', content: 'Hallo Emi' },
      { name: 'q-extra', filename: '', content: '' },
    ]);
    assert.match(page.body, /enctype="multipart\/form-data"/);
    assert.match(page.body, /type="file"/);
    assert.match(page.body, /accept="\.pdf,\.txt"/);
    assert.equal(response.statusCode, 303, response.body);
    assert.equal(await tmpFiles(), before);

    const responses = (await emi.get(`/api/forms/${form.id}/responses`)).json().items as {
      answers: { question: string; text: string; file?: { name: string; size: number; url: string | null } }[];
    }[];
    assert.equal(responses.length, 1);
    const beleg = responses[0].answers.find((entry) => entry.question === 'beleg')!;
    assert.equal(beleg.text, 'Quittung Lea.txt');
    assert.equal(beleg.file?.size, 9);
    assert.match(beleg.file?.url ?? '', /^\/files\/folder\/[\w-]+\?select=[\w-]+$/);
    assert.equal(responses[0].answers.find((entry) => entry.question === 'extra')!.file, undefined);

    const node = one<{ id: string; parent_id: string; sha256: string; owner_id: number }>(
      "SELECT id, parent_id, sha256, owner_id FROM nodes WHERE name = 'Quittung Lea.txt' AND trashed_at IS NULL"
    )!;
    assert.equal(node.sha256, createHash('sha256').update('Hallo Emi').digest('hex'));
    const folder = one<{ name: string; parent_id: string }>('SELECT name, parent_id FROM nodes WHERE id = ?', node.parent_id)!;
    assert.equal(folder.name, 'Reise Kosten');
    assert.equal(one<{ name: string }>('SELECT name FROM nodes WHERE id = ?', folder.parent_id)!.name, 'Formular-Uploads');
    const activity = all<{ action: string; details: string | null }>('SELECT action, details FROM activity WHERE node_id = ?', node.id);
    assert.ok(activity.some((entry) => entry.action === 'link_upload' && JSON.parse(entry.details ?? '{}').form === 'Reise/Kosten'));

    const csv = await emi.get(`/api/forms/${form.id}/export`);
    assert.match(csv.body, /Quittung Lea\.txt/);
    const results = (await emi.get(`/api/forms/${form.id}/results`)).json().questions as { id: string; latest?: string[] }[];
    assert.deepEqual(results.find((entry) => entry.id === 'beleg')?.latest, ['Quittung Lea.txt']);
  });

  it('weist falsche, zu große und fehlende Dateien ab', async () => {
    const form = await newForm(emi, 'Prüfung', QUESTIONS);
    const count = () => Number(one<{ total: number }>('SELECT COUNT(*) AS total FROM nodes')!.total);
    const nodes = count();
    const before = await tmpFiles();

    const wrong = await send(form.url, [
      { name: 'q-name', value: 'Mia' },
      { name: 'q-beleg', filename: 'programm.exe', content: 'MZ' },
    ]);
    assert.equal(wrong.response.statusCode, 400);
    assert.match(wrong.response.body, /Erlaubt sind nur diese Dateien: pdf, txt/);
    assert.match(wrong.response.body, /value="Mia"/);

    const big = await send(form.url, [
      { name: 'q-name', value: 'Mia' },
      { name: 'q-beleg', filename: 'gross.pdf', content: Buffer.alloc(1024 * 1024 + 10, 1) },
    ]);
    assert.equal(big.response.statusCode, 400);
    assert.match(big.response.body, /höchstens 1 MB/);

    const missing = await send(form.url, [{ name: 'q-name', value: 'Mia' }]);
    assert.equal(missing.response.statusCode, 400);
    assert.match(missing.response.body, /Lade eine Datei hoch/);

    const plain = new Client(app);
    const page = await plain.send({ method: 'GET', url: form.url, headers: { accept: 'text/html' }, remoteAddress: '127.0.8.1' });
    assert.equal(page.statusCode, 200);
    const urlencoded = await plain.send({
      method: 'POST',
      url: form.url,
      remoteAddress: '127.0.8.1',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
      payload: new URLSearchParams({ _csrf: plain.cookies.get('moe_csrf') ?? plain.csrf, 'q-name': 'Mia' }).toString(),
    });
    assert.equal(urlencoded.statusCode, 400);
    assert.match(urlencoded.body, /Lade eine Datei hoch/);

    const extra = await send(form.url, [
      { name: 'q-name', value: 'Mia' },
      { name: 'q-beleg', filename: 'a.txt', content: 'a' },
      { name: 'q-extra', filename: 'b.txt', content: 'b' },
      { name: 'q-fremd', filename: 'c.txt', content: 'c' },
    ]);
    assert.equal(extra.response.statusCode, 400);
    assert.match(extra.response.body, /nicht vollständig an/);

    assert.equal(count(), nodes);
    assert.equal(await tmpFiles(), before);
    assert.equal((await emi.get(`/api/forms/${form.id}/responses`)).json().items.length, 0);
  });

  it('nimmt nichts an, wenn beim Besitzer kein Platz ist', async () => {
    const form = await newForm(mia, 'Fotos', [{ id: 'bild', kind: 'file', title: 'Dein Bild', required: true }]);
    const used = Number(
      one<{ total: number }>('SELECT COALESCE(SUM(size), 0) AS total FROM nodes WHERE owner_id = ? AND type = ?', miaId, 'file')!.total
    );
    assert.equal((await emi.json('PATCH', `/api/admin/users/${miaId}`, { quota: used + 3 })).statusCode, 200);
    const full = await send(form.url, [{ name: 'q-bild', filename: 'bild.png', content: 'zu groß' }]);
    assert.equal(full.response.statusCode, 400);
    assert.match(full.response.body, /kein Platz/);
    assert.equal((await mia.get(`/api/forms/${form.id}/responses`)).json().items.length, 0);
    await emi.json('PATCH', `/api/admin/users/${miaId}`, { quota: null });
    const fine = await send(form.url, [{ name: 'q-bild', filename: 'bild.png', content: 'passt' }]);
    assert.equal(fine.response.statusCode, 303, fine.response.body);
  });
});
