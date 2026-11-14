import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import yauzl from 'yauzl';
import { Client, createApp, setUp } from './helpers.ts';

const app = await createApp();
let emi: Client;
let root = '';

function unzip(data: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const entries = new Map<string, Buffer>();
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) {
          entries.set(entry.fileName, Buffer.alloc(0));
          return zip.readEntry();
        }
        zip.openReadStream(entry, (failed, stream) => {
          if (failed || !stream) return reject(failed);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(entries));
      zip.readEntry();
    });
  });
}

before(async () => {
  emi = await setUp(app);
  root = (await emi.get('/api/session')).json().user.rootId;
  const created = await emi.json('POST', '/api/admin/users', {
    username: 'mia',
    name: 'Mia',
    email: 'mia@example.com',
    password: 'passwort-von-mia',
  });
  assert.equal(created.statusCode, 200, created.body);
});

after(() => app.close());

describe('Datenexport', () => {
  it('packt alle Dateien und eine Übersicht über das Konto in ein ZIP', async () => {
    const trip = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Reisen' })).json().node.id;
    const plan = (await emi.upload(trip, 'Plan.txt', Buffer.from('Kyoto mit Lea'))).json().node.id;
    const gone = (await emi.json('POST', `/api/nodes/${root}/folders`, { name: 'Alt' })).json().node.id;
    await emi.upload(gone, 'Weg.txt', Buffer.from('nicht mehr da'));
    await emi.json('POST', '/api/nodes/trash', { ids: [gone] });
    await emi.json('PUT', `/api/nodes/${plan}/star`, { starred: true });
    const tag = (await emi.json('POST', '/api/tags', { name: 'Wichtig', color: 'red' })).json().tag;
    await emi.json('PUT', '/api/nodes/tags', { ids: [plan], add: [tag.id] });
    await emi.json('POST', `/api/nodes/${trip}/links`, { label: 'Für Emily' });
    const miaId = (await emi.get('/api/admin/users')).json().items.find((user: { username: string }) => user.username === 'mia').id;
    await emi.json('POST', `/api/nodes/${trip}/grants`, { userId: miaId, permission: 'edit' });
    await emi.json('POST', `/api/nodes/${plan}/comments`, { text: 'Noch Tickets kaufen' });
    await emi.json('POST', '/api/searches', { name: 'Texte', query: 'type=document' });

    const response = await emi.get('/api/account/export');
    assert.equal(response.statusCode, 200, response.body.slice(0, 200));
    assert.equal(response.headers['content-type'], 'application/zip');
    assert.match(String(response.headers['content-disposition']), /moecloud-emi-\d{4}-\d{2}-\d{2}\.zip/);
    const entries = await unzip(response.rawPayload);
    assert.equal(entries.get('Dateien/Reisen/Plan.txt')?.toString(), 'Kyoto mit Lea');
    assert.ok(![...entries.keys()].some((name) => name.includes('Weg.txt')));
    const data = JSON.parse(entries.get('konto.json')!.toString());
    assert.equal(data.format, 'moecloud-export');
    assert.equal(data.profile.username, 'emi');
    assert.equal(data.settings.mailLogins, true);
    assert.deepEqual(data.starred, ['Dateien/Reisen/Plan.txt']);
    assert.deepEqual(data.tags, [{ name: 'Wichtig', color: 'red', files: ['Dateien/Reisen/Plan.txt'] }]);
    assert.equal(data.links[0].path, 'Dateien/Reisen');
    assert.equal(data.links[0].label, 'Für Emily');
    assert.equal(data.links[0].token, undefined);
    assert.deepEqual(
      data.shares.map((share: { path: string; user: string; permission: string }) => [share.path, share.user, share.permission]),
      [['Dateien/Reisen', 'mia', 'edit']]
    );
    assert.equal(data.comments[0].file, 'Dateien/Reisen/Plan.txt');
    assert.deepEqual(data.searches, [{ name: 'Texte', query: 'type=document' }]);
    const log = (await emi.get('/api/account/security')).json();
    assert.ok(log.items.some((entry: { action: string }) => entry.action === 'account_exported'));
  });

  it('verlangt eine Anmeldung', async () => {
    assert.equal((await new Client(app).get('/api/account/export')).statusCode, 401);
  });
});
