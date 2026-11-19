import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client, createApp, login, setUp } from './helpers.ts';
import { value } from '../src/lib/db.ts';

const app = await createApp();
let emi: Client;
let mia: Client;
let lea: Client;
let miaId = 0;
let leaId = 0;
let teamId = 0;
let rootId = '';
const MB = 1024 * 1024;

async function file(client: Client, parent: string, name: string, content: Buffer | string = 'Hallo Lea') {
  return client.upload(parent, name, Buffer.from(content), 64 * 1024);
}

const names = (items: { name: string }[]) => items.map((item) => item.name).sort();

before(async () => {
  emi = await setUp(app);
  miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
  leaId = (await emi.json('POST', '/api/admin/users', { username: 'lea', name: 'Lea', password: 'leas-passwort-123' })).json().user.id;
  mia = await login(app, 'mia', 'mias-passwort-123');
  lea = await login(app, 'lea', 'leas-passwort-123');
});

after(async () => {
  await app.close();
});

describe('Teamordner', () => {
  it('legt nur die Verwaltung an, mit eigenem Speicher und ohne sichtbares Konto', async () => {
    assert.equal((await mia.json('POST', '/api/admin/teams', { name: 'Marketing' })).statusCode, 403);
    const created = await emi.json('POST', '/api/admin/teams', { name: 'Marketing', quota: 1 * MB, description: 'Alles für Kampagnen' });
    assert.equal(created.statusCode, 200, created.body);
    const team = created.json().team;
    teamId = team.id;
    rootId = team.rootId;
    assert.equal(team.name, 'Marketing');
    assert.equal(team.quota, 1 * MB);
    assert.equal(team.used, 0);
    assert.equal(team.role, null);
    assert.equal(team.canManage, true);
    assert.deepEqual(team.members, { people: [], groups: [] });
    assert.equal((await emi.json('POST', '/api/admin/teams', { name: 'marketing' })).statusCode, 409);
    assert.equal((await emi.json('POST', '/api/admin/teams', { name: ' ' })).statusCode, 400);
    const people = (await emi.get('/api/admin/users')).json().items as { username: string }[];
    assert.deepEqual(people.map((user) => user.username).sort(), ['emi', 'lea', 'mia']);
    assert.equal((await emi.get('/api/admin/overview')).json().users ?? 3, 3);
    assert.deepEqual((await emi.get('/api/users/search?q=Marketing')).json().items, []);
    assert.equal(value<number>("SELECT COUNT(*) FROM users WHERE role = 'team'"), 1);
  });

  it('zeigt den Teamordner nur Mitgliedern und richtet sich nach ihrer Rolle', async () => {
    assert.deepEqual((await mia.get('/api/teams')).json().items, []);
    assert.equal((await mia.get(`/api/nodes/${rootId}/children`)).statusCode, 404);
    assert.equal((await emi.get(`/api/nodes/${rootId}/children`)).statusCode, 404);
    assert.equal((await mia.get(`/api/teams/${teamId}`)).statusCode, 404);
    const added = await emi.json('PUT', `/api/teams/${teamId}/people/${miaId}`, { role: 'edit' });
    assert.equal(added.statusCode, 200, added.body);
    assert.deepEqual(
      added.json().team.members.people.map((person: { name: string; role: string }) => [person.name, person.role]),
      [['Mia', 'edit']]
    );
    await emi.json('PUT', `/api/teams/${teamId}/people/${leaId}`, { role: 'view' });
    const mine = (await mia.get('/api/teams')).json().items;
    assert.equal(mine.length, 1);
    assert.equal(mine[0].role, 'edit');
    assert.equal(mine[0].canManage, false);
    assert.equal(mine[0].members, undefined);
    const listing = (await mia.get(`/api/nodes/${rootId}/children`)).json();
    assert.equal(listing.role, 'edit');
    assert.equal(listing.folder.name, 'Marketing');
    assert.deepEqual(listing.team, { id: teamId, name: 'Marketing', role: 'edit', canManage: false });
    assert.deepEqual(listing.breadcrumbs, [{ id: rootId, name: 'Marketing' }]);
    const shared = (await mia.get('/api/shared')).json().withMe;
    assert.deepEqual(
      shared.map((node: { name: string; team: boolean }) => [node.name, node.team]),
      [['Marketing', true]]
    );
    const notes = (await mia.get('/api/notifications')).json().items as { title: string }[];
    assert.ok(notes.some((note) => note.title === 'Emi hat dich in den Teamordner „Marketing“ aufgenommen'));
    assert.equal((await file(lea, rootId, 'nein.txt')).statusCode, 403);
    assert.equal((await mia.json('PATCH', `/api/nodes/${rootId}`, { name: 'Anders' })).statusCode, 403);
    assert.equal((await mia.json('POST', '/api/nodes/trash', { ids: [rootId] })).statusCode, 403);
  });

  it('rechnet Dateien dem Teamordner an und hält sein Kontingent ein', async () => {
    const plan = await file(mia, rootId, 'Plan.txt', 'x'.repeat(1000));
    assert.equal(plan.statusCode, 200, plan.body);
    assert.equal((await mia.get('/api/storage')).json().used, 0);
    assert.equal((await mia.get('/api/teams')).json().items[0].used, 1000);
    const big = await file(mia, rootId, 'Zu gross.bin', Buffer.alloc(1 * MB));
    assert.equal(big.statusCode, 507);
    assert.equal(big.json().error.message, 'Der Speicher dieses Teamordners ist voll');
    const sub = (await mia.json('POST', `/api/nodes/${rootId}/folders`, { name: 'Kampagnen' })).json().node.id;
    assert.equal((await file(mia, sub, 'Herbst.md', '# Herbst')).statusCode, 200);
    assert.deepEqual(names((await lea.get(`/api/nodes/${rootId}/children`)).json().items), ['Kampagnen', 'Plan.txt']);
    assert.equal((await lea.get(`/api/nodes/${plan.json().node.id}/content`)).body, 'x'.repeat(1000));
  });

  it('nimmt eigene Dateien beim Verschieben auf, solange darin nichts geteilt ist', async () => {
    const made = (await emi.json('POST', '/api/admin/teams', { name: 'Umzug', quota: 1 * MB })).json().team;
    await emi.json('PUT', `/api/teams/${made.id}/people/${miaId}`, { role: 'edit' });
    await emi.json('PUT', `/api/teams/${made.id}/people/${leaId}`, { role: 'edit' });
    const home = (await mia.get('/api/session')).json().user.rootId;
    const ideas = (await mia.json('POST', `/api/nodes/${home}/folders`, { name: 'Ideen' })).json().node.id;
    const list = (await file(mia, ideas, 'Liste.txt', 'y'.repeat(500))).json().node.id;
    assert.equal((await mia.get('/api/storage')).json().used, 500);
    const link = (await mia.json('POST', `/api/nodes/${list}/links`, {})).json().link;
    const refused = await mia.json('POST', '/api/nodes/move', { ids: [ideas], target: made.rootId });
    assert.equal(refused.statusCode, 400);
    assert.match(refused.json().error.message, /^Darin ist noch etwas geteilt/);
    assert.equal((await mia.json('DELETE', `/api/links/${link.id}`)).statusCode, 200);
    const moved = await mia.json('POST', '/api/nodes/move', { ids: [ideas], target: made.rootId });
    assert.equal(moved.statusCode, 200, moved.body);
    assert.equal((await mia.get('/api/storage')).json().used, 0);
    assert.equal((await mia.get(`/api/teams/${made.id}`)).json().team.used, 500);
    assert.equal(value<number>('SELECT COUNT(*) FROM nodes WHERE owner_id = ? AND id IN (?, ?)', miaId, ideas, list), 0);
    assert.deepEqual(names((await lea.get(`/api/nodes/${ideas}/children`)).json().items), ['Liste.txt']);
    const big = (await file(mia, home, 'Gross.bin', Buffer.alloc(1 * MB))).json().node.id;
    const full = await mia.json('POST', '/api/nodes/move', { ids: [big], target: made.rootId });
    assert.equal(full.statusCode, 507);
    assert.equal(full.json().error.message, 'Der Speicher dieses Teamordners ist voll');
    assert.equal(value<number>('SELECT owner_id FROM nodes WHERE id = ?', big), miaId);
    for (const [client, target] of [
      [mia, home],
      [lea, (await lea.get('/api/session')).json().user.rootId],
    ] as const) {
      const out = await client.json('POST', '/api/nodes/move', { ids: [list], target });
      assert.equal(out.statusCode, 400);
      assert.equal(out.json().error.message, 'Aus geteilten Ordnern und Teamordnern heraus kannst du nur kopieren');
    }
    const copied = await mia.json('POST', '/api/nodes/copy', { ids: [list], target: home });
    assert.equal(copied.statusCode, 200, copied.body);
    assert.equal((await emi.json('DELETE', `/api/admin/teams/${made.id}?confirm=Umzug`)).statusCode, 200);
    const rest = [big, copied.json().items[0].id];
    assert.equal((await mia.json('POST', '/api/nodes/trash', { ids: rest })).statusCode, 200);
    assert.equal((await mia.json('POST', '/api/nodes/delete', { ids: rest })).statusCode, 200);
    assert.equal((await mia.get('/api/storage')).json().used, 0);
  });

  it('findet Dateien aus Teamordnern in der Suche der Mitglieder', async () => {
    assert.deepEqual(names((await lea.get('/api/search?q=Herbst')).json().items), ['Herbst.md']);
    assert.deepEqual(names((await emi.get('/api/search?q=Herbst')).json().items), []);
  });

  it('lässt Mitglieder mit Schreibrecht Links anlegen, die beim Team bleiben', async () => {
    const plan = (await mia.get(`/api/nodes/${rootId}/children`)).json().items.find((item: { name: string }) => item.name === 'Plan.txt');
    const link = await mia.json('POST', `/api/nodes/${plan.id}/links`, {});
    assert.equal(link.statusCode, 200, link.body);
    assert.equal((await lea.json('POST', `/api/nodes/${plan.id}/links`, {})).statusCode, 403);
    const token = link.json().link.token;
    assert.equal((await new Client(app).get(`/api/public/${token}`)).statusCode, 200);
    assert.equal((await emi.json('DELETE', `/api/admin/users/${miaId}`)).statusCode, 200);
    const share = (await new Client(app).get(`/api/public/${token}`)).json().share;
    assert.equal(share.node.name, 'Plan.txt');
    assert.equal(share.owner, 'Marketing');
    assert.equal(value<number>('SELECT COUNT(*) FROM nodes WHERE name = ?', 'Plan.txt'), 1);
    miaId = (await emi.json('POST', '/api/admin/users', { username: 'mia', name: 'Mia', password: 'mias-passwort-123' })).json().user.id;
    mia = await login(app, 'mia', 'mias-passwort-123');
    assert.deepEqual((await mia.get('/api/teams')).json().items, []);
  });

  it('gibt der Leitung Mitglieder und Papierkorb in die Hand, Namen und Speicher bleiben bei Admins', async () => {
    assert.equal((await mia.json('PUT', `/api/teams/${teamId}/people/${miaId}`, { role: 'manage' })).statusCode, 404);
    await emi.json('PUT', `/api/teams/${teamId}/people/${miaId}`, { role: 'manage' });
    assert.equal((await lea.json('PUT', `/api/teams/${teamId}/people/${leaId}`, { role: 'edit' })).statusCode, 403);
    const detail = (await mia.get(`/api/teams/${teamId}`)).json().team;
    assert.equal(detail.role, 'manage');
    assert.equal(detail.canManage, true);
    assert.deepEqual(
      detail.members.people.map((person: { name: string; role: string }) => [person.name, person.role]),
      [
        ['Lea', 'view'],
        ['Mia', 'manage'],
      ]
    );
    assert.equal((await mia.json('PUT', `/api/teams/${teamId}/people/${leaId}`, { role: 'edit' })).statusCode, 200);
    const found = (await mia.get(`/api/teams/${teamId}/candidates?q=em`)).json();
    assert.deepEqual(
      found.people.map((person: { name: string }) => person.name),
      ['Emi']
    );
    assert.equal((await lea.get(`/api/teams/${teamId}/candidates?q=em`)).statusCode, 403);
    assert.equal((await mia.json('PATCH', `/api/teams/${teamId}`, { description: 'Neu beschrieben', color: 'teal' })).statusCode, 200);
    assert.equal((await mia.json('PATCH', `/api/teams/${teamId}`, { name: 'Vertrieb' })).statusCode, 403);
    assert.equal((await mia.json('PATCH', `/api/teams/${teamId}`, { quota: 0 })).statusCode, 403);
    const plan = (await lea.get(`/api/nodes/${rootId}/children`)).json().items.find((item: { name: string }) => item.name === 'Plan.txt');
    assert.equal((await lea.json('POST', '/api/nodes/trash', { ids: [plan.id] })).statusCode, 200);
    assert.deepEqual((await lea.get('/api/trash')).json().items, []);
    assert.equal((await lea.get(`/api/teams/${teamId}/trash`)).statusCode, 403);
    const trash = (await mia.get(`/api/teams/${teamId}/trash`)).json().items;
    assert.deepEqual(names(trash), ['Plan.txt']);
    assert.equal((await mia.get('/api/teams')).json().items[0].trash, 1);
    assert.equal((await mia.json('POST', `/api/teams/${teamId}/trash/restore`, { ids: [plan.id] })).json().restored, 1);
    assert.deepEqual(names((await lea.get(`/api/nodes/${rootId}/children`)).json().items), ['Kampagnen', 'Plan.txt']);
    const activity = (await mia.get(`/api/nodes/${plan.id}/activity`)).json().items as { action: string; actor: { name: string } | null }[];
    assert.equal(activity.find((entry) => entry.action === 'restore')?.actor?.name, 'Mia');
  });

  it('bindet Teamordner über WebDAV neben den eigenen Ordnern ein, wenn das App-Passwort es vorsieht', async () => {
    const plain = (await lea.json('POST', '/api/account/app-passwords', { name: 'Altes Gerät' })).json();
    assert.equal(plain.item.shared, false);
    const without = await app.inject({
      method: 'PROPFIND' as 'GET',
      url: '/dav/',
      headers: { authorization: `Basic ${Buffer.from(`lea:${plain.token}`).toString('base64')}`, depth: '1' },
    });
    assert.equal(without.statusCode, 207);
    assert.doesNotMatch(without.body, /Marketing/);
    const hidden = await app.inject({
      method: 'GET',
      url: '/dav/Marketing/Plan.txt',
      headers: { authorization: `Basic ${Buffer.from(`lea:${plain.token}`).toString('base64')}` },
    });
    assert.equal(hidden.statusCode, 404);
    const created = (await lea.json('POST', '/api/account/app-passwords', { name: 'Laptop', shared: true })).json();
    assert.equal(created.item.shared, true);
    const token = created.token;
    const auth = `Basic ${Buffer.from(`lea:${token}`).toString('base64')}`;
    const dav = (method: string, url: string, headers: Record<string, string> = {}, payload?: string) =>
      app.inject({ method: method as 'GET', url, headers: { authorization: auth, ...headers }, payload });
    const list = await dav('PROPFIND', '/dav/', { depth: '1' });
    assert.equal(list.statusCode, 207);
    assert.match(list.body, /<d:href>\/dav\/Marketing\/<\/d:href>/);
    assert.match(list.body, /<d:displayname>Marketing<\/d:displayname>/);
    const inside = await dav('PROPFIND', '/dav/Marketing/', { depth: '1' });
    assert.match(inside.body, /\/dav\/Marketing\/Kampagnen\//);
    assert.match(inside.body, /\/dav\/Marketing\/Plan\.txt/);
    assert.equal((await dav('GET', '/dav/Marketing/Plan.txt')).body, 'x'.repeat(1000));
    assert.equal((await dav('PUT', '/dav/Marketing/Von Lea.txt', { 'content-type': 'text/plain' }, 'Hallo Emi')).statusCode, 201);
    const owner = value<string>("SELECT u.role FROM nodes n JOIN users u ON u.id = n.owner_id WHERE n.name = 'Von Lea.txt'");
    assert.equal(owner, 'team');
    assert.equal((await dav('DELETE', '/dav/Marketing/')).statusCode, 403);
    assert.equal((await dav('MKCOL', '/dav/Marketing/Kampagnen/Winter')).statusCode, 201);
    await emi.json('PUT', `/api/teams/${teamId}/people/${leaId}`, { role: 'view' });
    assert.equal((await dav('PUT', '/dav/Marketing/Nein.txt', { 'content-type': 'text/plain' }, 'Nein')).statusCode, 403);
    assert.equal((await dav('GET', '/dav/Marketing/Von Lea.txt')).body, 'Hallo Emi');
    await emi.json('PUT', `/api/teams/${teamId}/people/${leaId}`, { role: 'edit' });
    const stranger = (await emi.json('POST', '/api/account/app-passwords', { name: 'Laptop', shared: true })).json().token;
    const other = await app.inject({
      method: 'PROPFIND' as 'GET',
      url: '/dav/Marketing/',
      headers: { authorization: `Basic ${Buffer.from(`emi:${stranger}`).toString('base64')}`, depth: '1' },
    });
    assert.equal(other.statusCode, 404);
  });

  it('nimmt Gruppen auf, benennt um und passt das Kontingent an', async () => {
    const group = (await emi.json('POST', '/api/admin/groups', { name: 'Agentur', members: [leaId] })).json().group.id;
    await emi.json('DELETE', `/api/teams/${teamId}/people/${leaId}`);
    assert.deepEqual((await lea.get('/api/teams')).json().items, []);
    const added = await emi.json('PUT', `/api/teams/${teamId}/groups/${group}`, { role: 'view' });
    assert.deepEqual(added.json().team.members.groups, [{ id: group, name: 'Agentur', members: 1, role: 'view' }]);
    assert.equal((await lea.get('/api/teams')).json().items[0].role, 'view');
    assert.equal((await lea.json('POST', `/api/teams/${teamId}/leave`)).statusCode, 400);
    const renamed = await emi.json('PATCH', `/api/teams/${teamId}`, { name: 'Vertrieb', quota: 0 });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal(renamed.json().team.quota, null);
    assert.equal((await lea.get(`/api/nodes/${rootId}/children`)).json().folder.name, 'Vertrieb');
    assert.equal((await file(mia, rootId, 'Jetzt passt es.bin', Buffer.alloc(1 * MB))).statusCode, 200);
    await emi.json('DELETE', `/api/teams/${teamId}/groups/${group}`);
    assert.equal((await lea.get(`/api/nodes/${rootId}/children`)).statusCode, 404);
  });

  it('sperrt das versteckte Konto für Anmeldung, Freigaben und die Personenverwaltung', async () => {
    const account = value<number>("SELECT id FROM users WHERE role = 'team'")!;
    const username = value<string>("SELECT username FROM users WHERE role = 'team'")!;
    const page = new Client(app);
    await page.get('/login', { accept: 'text/html' });
    const attempt = await page.form('/login', {
      _csrf: page.cookies.get('moe_csrf')!,
      login: username,
      password: 'irgendein-passwort',
      next: '/files',
    });
    assert.notEqual(attempt.statusCode, 303);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${account}`, { name: 'Gekapert' })).statusCode, 404);
    assert.equal((await emi.json('DELETE', `/api/admin/users/${account}`)).statusCode, 404);
    assert.equal((await emi.json('POST', `/api/admin/users/${account}/password`, { password: 'neues-passwort-123' })).statusCode, 404);
    const own = (await emi.get('/api/session')).json().user.rootId;
    const folder = (await emi.json('POST', `/api/nodes/${own}/folders`, { name: 'Privat' })).json().node.id;
    assert.equal((await emi.json('POST', `/api/nodes/${folder}/grants`, { userId: account, permission: 'view' })).statusCode, 404);
    assert.equal((await emi.json('PUT', `/api/teams/${teamId}/people/${account}`, { role: 'edit' })).statusCode, 404);
  });

  it('löscht den Teamordner erst mit dem Namen als Bestätigung, samt Dateien', async () => {
    assert.equal((await mia.json('DELETE', `/api/admin/teams/${teamId}?confirm=Vertrieb`)).statusCode, 403);
    assert.equal((await emi.json('DELETE', `/api/admin/teams/${teamId}?confirm=falsch`)).statusCode, 400);
    assert.equal((await emi.json('DELETE', `/api/admin/teams/${teamId}?confirm=vertrieb`)).statusCode, 200);
    assert.deepEqual((await mia.get('/api/teams')).json().items, []);
    assert.equal(value<number>("SELECT COUNT(*) FROM users WHERE role = 'team'"), 0);
    assert.equal(value<number>('SELECT COUNT(*) FROM nodes WHERE name IN (?, ?)', 'Plan.txt', 'Herbst.md'), 0);
    assert.deepEqual((await emi.get('/api/admin/teams')).json().items, []);
  });
});

describe('Gastkonten', () => {
  let guest: Client;
  let guestId = 0;
  let team = 0;
  let teamRoot = '';

  it('haben keinen eigenen Speicher und arbeiten nur in Geteiltem', async () => {
    const created = await emi.json('POST', '/api/admin/users', {
      username: 'emily',
      name: 'Emily',
      password: 'emilys-passwort-1',
      role: 'guest',
    });
    assert.equal(created.statusCode, 200, created.body);
    guestId = created.json().user.id;
    assert.equal(created.json().user.role, 'guest');
    guest = await login(app, 'emily', 'emilys-passwort-1');
    const session = (await guest.get('/api/session')).json().user;
    assert.equal(session.role, 'guest');
    const upload = await file(guest, session.rootId, 'Meins.txt');
    assert.equal(upload.statusCode, 403);
    assert.match(upload.json().error.message, /^Gastkonten haben keinen eigenen Speicher/);
    assert.equal((await guest.json('POST', `/api/nodes/${session.rootId}/folders`, { name: 'Ordner' })).statusCode, 403);
    assert.equal((await guest.json('POST', `/api/nodes/${session.rootId}/text`, { name: 'Notiz.md' })).statusCode, 403);
    const made = (await emi.json('POST', '/api/admin/teams', { name: 'Agentur' })).json().team;
    team = made.id;
    teamRoot = made.rootId;
    assert.equal((await emi.json('PUT', `/api/teams/${team}/people/${guestId}`, { role: 'manage' })).statusCode, 400);
    assert.equal((await emi.json('PUT', `/api/teams/${team}/people/${guestId}`, { role: 'edit' })).statusCode, 200);
    const entwurf = await file(guest, teamRoot, 'Entwurf.txt', 'Für Mia');
    assert.equal(entwurf.statusCode, 200, entwurf.body);
    assert.equal((await guest.json('POST', `/api/nodes/${entwurf.json().node.id}/links`, {})).statusCode, 403);
    assert.equal((await guest.json('POST', `/api/nodes/${teamRoot}/folders`, { name: 'Lieferungen' })).statusCode, 200);
    const people = (await emi.get(`/api/teams/${team}`)).json().team.members.people;
    assert.deepEqual(
      people.map((person: { name: string; guest: boolean }) => [person.name, person.guest]),
      [['Emily', true]]
    );
  });

  it('entstehen aus einem Konto nur, wenn dort keine eigenen Dateien mehr liegen', async () => {
    const own = (await mia.get('/api/session')).json().user.rootId;
    const kept = await file(mia, own, 'Eigenes.txt');
    assert.equal((await emi.json('PATCH', `/api/admin/users/${miaId}`, { role: 'guest' })).statusCode, 400);
    await mia.json('POST', '/api/nodes/trash', { ids: [kept.json().node.id] });
    await mia.json('DELETE', '/api/trash');
    assert.equal((await emi.json('PATCH', `/api/admin/users/${miaId}`, { role: 'guest' })).statusCode, 200);
    assert.equal((await file(mia, own, 'Geht nicht.txt')).statusCode, 403);
    assert.equal((await emi.json('PATCH', `/api/admin/users/${miaId}`, { role: 'user' })).statusCode, 200);
    assert.equal((await file(mia, own, 'Geht wieder.txt')).statusCode, 200);
  });

  it('kommen per Einladung direkt in einen Teamordner', async () => {
    const invite = await emi.json('POST', '/api/admin/invites', { role: 'guest', teamId: team, teamRole: 'edit', days: 3 });
    assert.equal(invite.statusCode, 200, invite.body);
    assert.equal(invite.json().invite.role, 'guest');
    assert.equal(invite.json().invite.team, 'Agentur');
    const token = new URL(invite.json().url).searchParams.get('invite')!;
    const page = new Client(app);
    await page.get(`/register?invite=${token}`, { accept: 'text/html' });
    const done = await page.form('/register', {
      _csrf: page.cookies.get('moe_csrf')!,
      invite: token,
      name: 'Lea Gast',
      username: 'leagast',
      password: 'leas-gast-passwort',
    });
    assert.equal(done.statusCode, 303, done.body);
    await page.refreshCsrf();
    assert.equal((await page.get('/api/session')).json().user.role, 'guest');
    const teams = (await page.get('/api/teams')).json().items;
    assert.deepEqual(
      teams.map((entry: { name: string; role: string }) => [entry.name, entry.role]),
      [['Agentur', 'edit']]
    );
    assert.equal((await file(page, teamRoot, 'Von Lea.txt')).statusCode, 200);
  });
});

describe('Nutzungsbedingungen', () => {
  it('verlangen die Zustimmung, bevor es im Browser weitergeht', async () => {
    assert.equal((await new Client(app).get('/nutzungsbedingungen', { accept: 'text/html' })).statusCode, 404);
    const saved = await emi.json('PATCH', '/api/admin/settings', {
      'site.terms': '## Regeln\n\nBitte nett bleiben.\nKeine fremden Dateien hochladen.',
      'terms.required': true,
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().settings['terms.version'], 1);
    assert.equal((await emi.get('/api/teams')).statusCode, 200);
    const state = (await emi.get('/api/admin/terms')).json();
    assert.equal(state.active, true);
    assert.equal(state.accepted, 1);
    const open = await new Client(app).get('/nutzungsbedingungen', { accept: 'text/html' });
    assert.equal(open.statusCode, 200);
    assert.match(open.body, /<h2>Regeln<\/h2>/);
    assert.match(open.body, /Bitte nett bleiben\.<br\s*\/?>Keine fremden Dateien hochladen\./);
    assert.doesNotMatch(open.body, /Ich stimme zu/);
    const blocked = await lea.get('/api/teams');
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error.code, 'terms_required');
    assert.equal((await lea.get('/api/session')).statusCode, 200);
    const page = await lea.get('/files', { accept: 'text/html' });
    assert.equal(page.statusCode, 302);
    assert.equal(page.headers.location, '/nutzungsbedingungen');
    const form = await lea.get('/nutzungsbedingungen', { accept: 'text/html' });
    assert.match(form.body, /Ich stimme zu/);
    const wrong = await lea.form('/nutzungsbedingungen', { _csrf: 'falsch' });
    assert.equal(wrong.statusCode, 403);
    assert.equal((await lea.get('/api/teams')).statusCode, 403);
    const csrf = (await lea.get('/api/session')).json().csrf;
    const accepted = await lea.form('/nutzungsbedingungen', { _csrf: csrf });
    assert.equal(accepted.statusCode, 303);
    assert.equal((await lea.get('/api/teams')).statusCode, 200);
    assert.equal((await emi.get('/api/admin/terms')).json().accepted, 2);
    const log = (await lea.get('/api/account/security')).json().items as { action: string }[];
    assert.ok(log.some((entry) => entry.action === 'terms_accepted'));
  });

  it('lassen App-Passwörter weiterlaufen und fragen nach einer neuen Fassung wieder', async () => {
    const token = (await mia.get('/api/session')).statusCode;
    assert.equal(token, 200);
    assert.equal((await mia.get('/api/teams')).statusCode, 403);
    const csrf = (await mia.get('/api/session')).json().csrf;
    await mia.form('/nutzungsbedingungen', { _csrf: csrf });
    const app_ = (await mia.json('POST', '/api/account/app-passwords', { name: 'Handy' })).json().token;
    const renewed = await emi.json('POST', '/api/admin/terms/renew');
    assert.equal(renewed.json().version, 2);
    assert.equal(renewed.json().accepted, 1);
    assert.equal((await mia.get('/api/teams')).statusCode, 403);
    const basic = await app.inject({
      method: 'GET',
      url: '/api/teams',
      headers: { authorization: `Basic ${Buffer.from(`mia:${app_}`).toString('base64')}` },
    });
    assert.equal(basic.statusCode, 200);
    assert.equal((await emi.json('PATCH', '/api/admin/settings', { 'terms.required': false })).statusCode, 200);
    assert.equal((await mia.get('/api/teams')).statusCode, 200);
  });
});
