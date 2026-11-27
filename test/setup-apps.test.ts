import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as settings from '../src/services/settings.ts';
import { Client, createApp, setupCode } from './helpers.ts';

const app = await createApp();
const defaultPalette = (await import('../src/lib/default-palette.json', { with: { type: 'json' } })).default;

after(() => app.close());

describe('Einrichtung mit Funktionswahl', () => {
  it('schaltet nur die gewählten Funktionen ein', async () => {
    const client = new Client(app);
    await client.get('/');
    const response = await client.json('POST', '/api/setup', {
      code: setupCode(),
      siteName: 'Cloud von Mia',
      siteUrl: 'http://localhost:3000',
      language: 'de',
      seed: '#8b5cf6',
      palette: defaultPalette,
      registration: 'closed',
      defaultQuota: 0,
      admin: { username: 'mia', name: 'Mia', email: 'mia@example.com', password: 'sehr-sicheres-passwort' },
      apps: ['calendar', 'tasks', 'contacts', 'mail', 'bookmarks'],
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(settings.get('calendar.enabled'), true);
    assert.equal(settings.get('tasks.enabled'), true);
    assert.equal(settings.get('calendar.booking'), false);
    assert.equal(settings.get('photos.enabled'), false);
    assert.equal(settings.get('webmail.enabled'), true);
    assert.equal(settings.get('chat.enabled'), false);
    assert.equal(settings.get('bookmarks.enabled'), true);
    await client.refreshCsrf();
    assert.equal((await client.get('/api/photos')).statusCode, 404);
    assert.equal((await client.get('/api/contacts/books')).statusCode, 200);
  });
});
