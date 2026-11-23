import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { all, one } from '../src/lib/db.ts';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, login, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let address = 0;

interface Form {
  id: string;
  title: string;
  url: string;
  state: string;
  responses: number;
  questions: {
    id: string;
    kind: string;
    title: string;
    options: { id: string; label: string }[];
    min: number | null;
    max: number | null;
  }[];
}

const QUESTIONS = [
  { id: 'name', kind: 'text', title: 'Wie heißt du?', required: true },
  { id: 'mail', kind: 'email', title: 'E-Mail', required: false },
  {
    id: 'essen',
    kind: 'single',
    title: 'Was möchtest du essen?',
    required: true,
    options: [
      { id: 'pizza', label: 'Pizza' },
      { id: 'salat', label: 'Salat' },
    ],
  },
  {
    id: 'tage',
    kind: 'multiple',
    title: 'An welchen Tagen kannst du?',
    options: [
      { id: 'sa', label: 'Samstag' },
      { id: 'so', label: 'Sonntag' },
    ],
  },
  { id: 'gaeste', kind: 'number', title: 'Wie viele Gäste bringst du mit?', min: 0, max: 5 },
  { id: 'note', kind: 'scale', title: 'Wie gefällt dir die Idee?', min: 1, max: 5, low: 'Gar nicht', high: 'Sehr' },
  { id: 'datum', kind: 'date', title: 'Wann bist du geboren?' },
  { id: 'wunsch', kind: 'longtext', title: 'Noch ein Wunsch?' },
];

async function newForm(client: Client, title = 'Sommerfest', patch: Record<string, unknown> = { questions: QUESTIONS }) {
  const made = await client.json('POST', '/api/forms', { title });
  assert.equal(made.statusCode, 200, made.body);
  const form = made.json().form as Form;
  const saved = await client.json('PATCH', `/api/forms/${form.id}`, patch);
  assert.equal(saved.statusCode, 200, saved.body);
  return saved.json().form as Form;
}

async function visitor(url: string, client = new Client(app)) {
  const remoteAddress = `127.0.6.${(address++ % 250) + 1}`;
  const page = await client.send({ method: 'GET', url, headers: { accept: 'text/html' }, remoteAddress });
  return { client, page, remoteAddress };
}

async function answer(url: string, fields: Record<string, string>, client?: Client) {
  const { client: person, page, remoteAddress } = await visitor(url, client);
  assert.equal(page.statusCode, 200, page.body);
  const csrf = person.cookies.get('moe_csrf') ?? person.csrf;
  const response = await person.send({
    method: 'POST',
    url,
    remoteAddress,
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
    payload: new URLSearchParams({ _csrf: csrf, ...fields }).toString(),
  });
  return { response, client: person };
}

const FULL = {
  'q-name': 'Lea',
  'q-mail': 'lea@example.com',
  'q-essen': 'pizza',
  'q-tage-sa': '1',
  'q-tage-so': '1',
  'q-gaeste': '2',
  'q-note': '4',
  'q-datum': '1999-02-28',
  'q-wunsch': 'Bitte mit Musik',
};

before(async () => {
  emi = await setUp(app);
  const made = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'noch-ein-sicheres-passwort',
  });
  assert.equal(made.statusCode, 200, made.body);
  mia = await login(app, 'mia', 'noch-ein-sicheres-passwort');
});

after(async () => {
  await app.close();
});

describe('Formulare anlegen', () => {
  it('legt ein Formular mit einer ersten Frage an und speichert Fragen und Einstellungen', async () => {
    const made = await emi.json('POST', '/api/forms', { title: 'Anmeldung' });
    assert.equal(made.statusCode, 200, made.body);
    const form = made.json().form as Form;
    assert.equal(form.questions.length, 1);
    assert.equal(form.questions[0].kind, 'text');
    assert.equal(form.state, 'open');
    assert.match(form.url, /^\/f\/[A-Za-z0-9_-]{22}$/);
    const saved = await emi.json('PATCH', `/api/forms/${form.id}`, {
      questions: QUESTIONS,
      description: 'Sag uns bis Freitag Bescheid.',
      confirmation: 'Wir melden uns.',
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const fresh = saved.json().form as Form;
    assert.equal(fresh.questions.length, QUESTIONS.length);
    const scale = fresh.questions.find((entry) => entry.id === 'note')!;
    assert.deepEqual([scale.min, scale.max], [1, 5]);
    const text = fresh.questions.find((entry) => entry.id === 'name')!;
    assert.deepEqual([text.min, text.max, text.options], [null, null, []]);
    const listed = (await emi.get('/api/forms')).json().items as Form[];
    assert.equal(listed[0].id, form.id);
    assert.equal((await emi.get(`/api/forms/${form.id}`)).json().form.title, 'Anmeldung');
  });

  it('weist ungültige Formulare ab', async () => {
    const form = await newForm(emi, 'Prüfung', {});
    const cases: Record<string, unknown>[] = [
      { questions: [QUESTIONS[0], QUESTIONS[0]] },
      { questions: [{ id: 'a b', kind: 'text', title: 'X' }] },
      { questions: [{ id: 'x', kind: 'datei', title: 'X' }] },
      { questions: Array.from({ length: 101 }, (_, index) => ({ id: `f${index}`, kind: 'text', title: 'X' })) },
      {
        questions: [
          {
            id: 'x',
            kind: 'single',
            title: 'X',
            options: [
              { id: 'a', label: 'A' },
              { id: 'a', label: 'B' },
            ],
          },
        ],
      },
      { questions: [{ id: 'x', kind: 'number', title: 'X', min: 5, max: 1 }] },
      { named: true },
      { title: '' },
      { maxResponses: 0 },
    ];
    for (const patch of cases) {
      const refused = await emi.json('PATCH', `/api/forms/${form.id}`, patch);
      assert.equal(refused.statusCode, 400, JSON.stringify(patch).slice(0, 80));
    }
    const scale = await emi.json('PATCH', `/api/forms/${form.id}`, {
      questions: [{ id: 'x', kind: 'scale', title: 'Skala', min: 7, max: 30 }],
    });
    assert.deepEqual(
      [scale.json().form.questions[0].min, scale.json().form.questions[0].max],
      [1, 10],
      'Skalen beginnen bei 0 oder 1 und enden spätestens bei 10'
    );
  });

  it('gehört nur der Person, die es angelegt hat', async () => {
    const form = await newForm(emi, 'Nur meins');
    for (const [method, url] of [
      ['GET', `/api/forms/${form.id}`],
      ['PATCH', `/api/forms/${form.id}`],
      ['DELETE', `/api/forms/${form.id}`],
      ['GET', `/api/forms/${form.id}/results`],
      ['GET', `/api/forms/${form.id}/responses`],
      ['GET', `/api/forms/${form.id}/export`],
      ['POST', `/api/forms/${form.id}/copy`],
      ['POST', `/api/forms/${form.id}/token`],
      ['DELETE', `/api/forms/${form.id}/responses`],
    ] as const) {
      const response = await mia.json(method, url, method === 'PATCH' ? { title: 'Übernommen' } : undefined);
      assert.equal(response.statusCode, 404, `${method} ${url}`);
    }
    assert.ok(!((await mia.get('/api/forms')).json().items as Form[]).some((entry) => entry.id === form.id));
    assert.equal((await new Client(app).get('/api/forms')).statusCode, 401);
  });
});

describe('Formulare ausfüllen', () => {
  it('zeigt das Formular ohne Anmeldung und sammelt Antworten', async () => {
    const form = await newForm(emi);
    const { page } = await visitor(form.url);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Sommerfest/);
    assert.match(page.body, /name="q-essen" value="pizza"/);
    assert.match(page.body, /name="q-tage-sa"/);
    assert.match(page.body, /<meta name="robots" content="noindex">/);
    assert.equal(page.headers['referrer-policy'], 'no-referrer');
    const { response } = await answer(form.url, FULL);
    assert.equal(response.statusCode, 303, response.body);
    assert.equal(response.headers.location, `${form.url}?gesendet`);
    const thanks = await new Client(app).get(`${form.url}?gesendet`, { accept: 'text/html' });
    assert.match(thanks.body, /Danke für deine Antwort/);
    const stored = one<{ answers: string; user_id: number | null; respondent: string | null }>(
      'SELECT answers, user_id, respondent FROM form_responses WHERE form_id = ?',
      form.id
    )!;
    assert.deepEqual(JSON.parse(stored.answers), {
      name: 'Lea',
      mail: 'lea@example.com',
      essen: 'pizza',
      tage: ['sa', 'so'],
      gaeste: 2,
      note: 4,
      datum: '1999-02-28',
      wunsch: 'Bitte mit Musik',
    });
    assert.equal(stored.user_id, null);
    assert.equal(stored.respondent, null);
  });

  it('prüft jede Antwort und zeigt Fehler samt bisheriger Eingaben', async () => {
    const form = await newForm(emi, 'Streng');
    const { response } = await answer(form.url, {
      'q-name': '  ',
      'q-mail': 'keine-adresse',
      'q-essen': 'schnitzel',
      'q-gaeste': '9',
      'q-note': '8',
      'q-datum': '2023-02-30',
      'q-wunsch': 'x'.repeat(4001),
    });
    assert.equal(response.statusCode, 400);
    for (const id of ['name', 'mail', 'essen', 'gaeste', 'note', 'datum', 'wunsch']) {
      assert.match(response.body, new RegExp(`class="question question--error" data-question="${id}"`), id);
    }
    assert.match(response.body, /Höchstens 5/);
    assert.match(response.body, /Das ist kein Datum/);
    assert.match(response.body, /value="keine-adresse"/);
    assert.equal(one('SELECT 1 AS found FROM form_responses WHERE form_id = ?', form.id), undefined);
    const ok = await answer(form.url, { 'q-name': 'Mia', 'q-essen': 'salat', 'q-gaeste': '1,5', 'q-note': '1' });
    assert.equal(ok.response.statusCode, 303, ok.response.body);
    const stored = JSON.parse(one<{ answers: string }>('SELECT answers FROM form_responses WHERE form_id = ?', form.id)!.answers);
    assert.deepEqual(stored, { name: 'Mia', essen: 'salat', gaeste: 1.5, note: 1 });
  });

  it('verlangt das Token aus der Seite und lässt Bots ins Leere laufen', async () => {
    const form = await newForm(emi, 'Geschützt');
    const { client, remoteAddress } = await visitor(form.url);
    const forged = await client.send({
      method: 'POST',
      url: form.url,
      remoteAddress,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ _csrf: 'x'.repeat(43), ...FULL }).toString(),
    });
    assert.equal(forged.statusCode, 403);
    const bot = await answer(form.url, { ...FULL, website: 'https://example.com' });
    assert.equal(bot.response.statusCode, 303);
    assert.equal(all('SELECT id FROM form_responses WHERE form_id = ?', form.id).length, 0);
  });

  it('nimmt nur eine Antwort pro Browser an, wenn das so eingestellt ist', async () => {
    const form = await newForm(emi, 'Einmal', { questions: QUESTIONS, once: true });
    const first = await answer(form.url, FULL);
    assert.equal(first.response.statusCode, 303);
    const again = await first.client.get(form.url, { accept: 'text/html' });
    assert.match(again.body, /Du hast schon geantwortet/);
    const repeat = await answer(form.url, FULL, first.client);
    assert.equal(repeat.response.statusCode, 200);
    assert.match(repeat.response.body, /Du hast schon geantwortet/);
    const thanks = await first.client.get(`${form.url}?gesendet`, { accept: 'text/html' });
    assert.doesNotMatch(thanks.body, /Noch eine Antwort senden/);
    assert.equal(all('SELECT id FROM form_responses WHERE form_id = ?', form.id).length, 1);
  });

  it('lässt nur Angemeldete antworten, auf Wunsch mit Namen und einmal pro Konto', async () => {
    const form = await newForm(emi, 'Intern', { questions: QUESTIONS, signedIn: true, named: true, once: true });
    const anonymous = await visitor(form.url);
    assert.equal(anonymous.page.statusCode, 401);
    assert.match(anonymous.page.body, /\/login\?next=%2Ff%2F/);
    const page = await mia.get(form.url, { accept: 'text/html' });
    assert.match(page.body, /Du antwortest als Mia/);
    const sent = await mia.form(form.url, { _csrf: mia.csrf, ...FULL });
    assert.equal(sent.statusCode, 303, sent.body);
    const second = await mia.form(form.url, { _csrf: mia.csrf, ...FULL });
    assert.match(second.body, /Du hast schon geantwortet/);
    assert.match((await mia.get(form.url, { accept: 'text/html' })).body, /Du hast schon geantwortet/);
    const responses = (await emi.get(`/api/forms/${form.id}/responses`)).json();
    assert.equal(responses.total, 1);
    assert.equal(responses.items[0].person.name, 'Mia');

    const hidden = await newForm(emi, 'Intern ohne Namen', { questions: QUESTIONS, signedIn: true, once: true });
    assert.equal((await mia.form(hidden.url, { _csrf: mia.csrf, ...FULL })).statusCode, 303);
    const row = one<{ user_id: number | null; respondent: string | null }>(
      'SELECT user_id, respondent FROM form_responses WHERE form_id = ?',
      hidden.id
    )!;
    assert.equal(row.user_id, null);
    assert.match(String(row.respondent), /^[0-9a-f]{64}$/);
    assert.equal((await emi.get(`/api/forms/${hidden.id}/responses`)).json().items[0].person, null);
    assert.match((await mia.form(hidden.url, { _csrf: mia.csrf, ...FULL })).body, /Du hast schon geantwortet/);
  });

  it('schließt, wenn es aus ist, die Frist um ist oder genug Antworten da sind', async () => {
    const closed = await newForm(emi, 'Zu', { questions: QUESTIONS, accepting: false });
    assert.equal(closed.state, 'closed');
    const page = await visitor(closed.url);
    assert.equal(page.page.statusCode, 410);
    assert.match(page.page.body, /nimmt keine Antworten mehr an/);
    assert.doesNotMatch(page.page.body, /name="q-name"/);

    const late = await newForm(emi, 'Vorbei', { questions: QUESTIONS, closesAt: Date.now() - 1000 });
    assert.equal(late.state, 'ended');
    assert.equal((await visitor(late.url)).page.statusCode, 410);

    const limited = await newForm(emi, 'Zwei Plätze', { questions: QUESTIONS, maxResponses: 2 });
    assert.equal((await answer(limited.url, FULL)).response.statusCode, 303);
    assert.equal((await answer(limited.url, FULL)).response.statusCode, 303);
    const third = await answer(limited.url, FULL).catch(() => null);
    assert.equal(third, null, 'die Seite selbst ist schon geschlossen');
    assert.equal((await visitor(limited.url)).page.statusCode, 410);
    assert.equal(all('SELECT id FROM form_responses WHERE form_id = ?', limited.id).length, 2);
    assert.equal((await emi.get(`/api/forms/${limited.id}`)).json().form.state, 'full');
  });

  it('gibt Bescheid und fasst weitere Antworten in einer Benachrichtigung zusammen', async () => {
    const form = await newForm(emi, 'Benachrichtigt');
    await answer(form.url, FULL);
    await answer(form.url, FULL);
    const notes = ((await emi.get('/api/notifications')).json().items as { kind: string; title: string; url: string }[]).filter(
      (entry) => entry.kind === 'form_response' && entry.url === `/files/forms/${form.id}#antworten`
    );
    assert.equal(notes.length, 1);
    assert.match(notes[0].title, /2 neue Antworten auf „Benachrichtigt“/);
    const quiet = await newForm(emi, 'Still', { questions: QUESTIONS, notify: false });
    await answer(quiet.url, FULL);
    assert.ok(
      !((await emi.get('/api/notifications')).json().items as { url: string }[]).some(
        (entry) => entry.url === `/files/forms/${quiet.id}#antworten`
      )
    );
  });

  it('maskiert alles, was Besucher und Ersteller eingeben', async () => {
    const form = await newForm(emi, '<script>alert(1)</script>', {
      questions: [{ id: 'x', kind: 'single', title: '<img src=x onerror=alert(1)>', options: [{ id: 'a', label: '"><b>fett</b>' }] }],
      description: '<iframe src="https://example.com"></iframe>',
    });
    const { page } = await visitor(form.url);
    assert.doesNotMatch(page.body, /<script>alert|<img src=x|<iframe|<b>fett/);
    assert.match(page.body, /&lt;script>alert\(1\)&lt;\/script>|&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });
});

describe('Antworten auswerten', () => {
  it('zählt Antworten pro Frage und zeigt Durchschnitte', async () => {
    const form = await newForm(emi, 'Auswertung');
    await answer(form.url, FULL);
    await answer(form.url, { ...FULL, 'q-essen': 'salat', 'q-tage-so': '', 'q-gaeste': '4', 'q-note': '2', 'q-wunsch': 'Kuchen' });
    await answer(form.url, { 'q-name': 'Emily', 'q-essen': 'pizza' });
    const results = (await emi.get(`/api/forms/${form.id}/results`)).json();
    assert.equal(results.total, 3);
    const byId = Object.fromEntries((results.questions as { id: string }[]).map((entry) => [entry.id, entry])) as Record<
      string,
      Record<string, unknown>
    >;
    assert.deepEqual(byId.essen.options, [
      { id: 'pizza', label: 'Pizza', count: 2 },
      { id: 'salat', label: 'Salat', count: 1 },
    ]);
    assert.deepEqual(byId.tage.options, [
      { id: 'sa', label: 'Samstag', count: 2 },
      { id: 'so', label: 'Sonntag', count: 1 },
    ]);
    assert.equal(byId.gaeste.average, 3);
    assert.deepEqual([byId.gaeste.min, byId.gaeste.max], [2, 4]);
    assert.equal(byId.note.average, 3);
    assert.equal((byId.note.options as { count: number }[]).map((entry) => entry.count).join(''), '01010');
    assert.deepEqual(byId.wunsch.latest, ['Kuchen', 'Bitte mit Musik']);
    assert.equal(byId.name.answered, 3);
    assert.equal(byId.mail.answered, 2);
  });

  it('listet einzelne Antworten seitenweise und löscht sie', async () => {
    const form = await newForm(emi, 'Liste');
    for (let index = 0; index < 5; index++) await answer(form.url, { ...FULL, 'q-name': `Person ${index}` });
    const page = (await emi.get(`/api/forms/${form.id}/responses?limit=2&offset=1`)).json();
    assert.equal(page.total, 5);
    assert.equal(page.items.length, 2);
    const first = page.items[0];
    assert.equal(first.answers.find((entry: { question: string }) => entry.question === 'essen').text, 'Pizza');
    assert.equal(first.answers.find((entry: { question: string }) => entry.question === 'tage').text, 'Samstag; Sonntag');
    assert.equal((await emi.json('DELETE', `/api/forms/${form.id}/responses/${first.id}`)).json().removed, 1);
    assert.equal((await emi.json('DELETE', `/api/forms/${form.id}/responses/${first.id}`)).statusCode, 404);
    assert.equal((await emi.json('DELETE', `/api/forms/${form.id}/responses`)).json().removed, 4);
    assert.equal((await emi.get(`/api/forms/${form.id}/results`)).json().total, 0);
  });

  it('lädt die Antworten als CSV mit entschärften Zellen', async () => {
    const form = await newForm(emi, 'Export');
    await answer(form.url, { ...FULL, 'q-name': '=HYPERLINK("http://example.com")', 'q-wunsch': 'Zeile 1\nZeile 2' });
    const csv = await emi.get(`/api/forms/${form.id}/export`);
    assert.equal(csv.statusCode, 200);
    assert.match(String(csv.headers['content-type']), /^text\/csv/);
    assert.match(String(csv.headers['content-disposition']), /attachment; filename="Export\.csv"/);
    const text = csv.body.slice(1);
    assert.match(text.split('\r\n')[0], /^"Zeitpunkt","Wie heißt du\?","E-Mail","Was möchtest du essen\?"/);
    assert.ok(text.includes(`"'=HYPERLINK(""http://example.com"")"`));
    assert.ok(text.includes('"Samstag; Sonntag"'));
    assert.ok(text.includes('"Zeile 1\nZeile 2"'));
  });
});

describe('Formulare verwalten', () => {
  it('kopiert ein Formular ohne Antworten und erneuert den Link', async () => {
    const form = await newForm(emi, 'Vorlage', { questions: QUESTIONS, once: true });
    await answer(form.url, FULL);
    const copy = (await emi.json('POST', `/api/forms/${form.id}/copy`)).json().form as Form & { once: boolean };
    assert.equal(copy.title, 'Kopie von Vorlage');
    assert.equal(copy.questions.length, QUESTIONS.length);
    assert.equal(copy.once, true);
    assert.equal(copy.responses, 0);
    assert.notEqual(copy.url, form.url);
    const renewed = (await emi.json('POST', `/api/forms/${form.id}/token`)).json().form as Form;
    assert.notEqual(renewed.url, form.url);
    assert.equal((await visitor(form.url)).page.statusCode, 404);
    assert.equal((await visitor(renewed.url)).page.statusCode, 200);
    assert.equal(renewed.responses, 1);
  });

  it('löscht Formulare samt Antworten', async () => {
    const form = await newForm(emi, 'Weg damit');
    await answer(form.url, FULL);
    assert.equal((await emi.json('DELETE', `/api/forms/${form.id}`)).statusCode, 200);
    assert.equal(all('SELECT id FROM form_responses WHERE form_id = ?', form.id).length, 0);
    assert.equal((await visitor(form.url)).page.statusCode, 404);
    assert.equal((await emi.get(`/api/forms/${form.id}`)).statusCode, 404);
  });

  it('lässt Gäste keine Formulare anlegen und lässt sich abschalten', async () => {
    const guest = await emi.json('POST', '/api/admin/users', {
      username: 'emily',
      name: 'Emily',
      email: 'emily@example.com',
      password: 'gast-passwort-sicher',
      role: 'guest',
    });
    assert.equal(guest.statusCode, 200, guest.body);
    const emily = await login(app, 'emily', 'gast-passwort-sicher');
    assert.equal((await emily.json('POST', '/api/forms', { title: 'Gast' })).statusCode, 403);
    const form = await newForm(emi, 'Bald aus');
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'forms.enabled': false })).statusCode, 200);
    try {
      assert.equal((await emi.json('POST', '/api/forms', { title: 'Neu' })).statusCode, 403);
      assert.equal((await emi.get('/api/forms')).statusCode, 403);
      assert.equal((await visitor(form.url)).page.statusCode, 404);
    } finally {
      assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'forms.enabled': true })).statusCode, 200);
    }
    assert.equal(settings.get('forms.enabled'), true);
    assert.equal((await visitor(form.url)).page.statusCode, 200);
  });

  it('nimmt keine Antworten mehr an, wenn das Konto gesperrt ist', async () => {
    const form = await newForm(mia, 'Von Mia');
    const id = (await mia.get('/api/session')).json().user.id as number;
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { disabled: true })).statusCode, 200);
    assert.equal((await visitor(form.url)).page.statusCode, 404);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${id}`, { disabled: false })).statusCode, 200);
    assert.equal((await visitor(form.url)).page.statusCode, 200);
  });
});
