import { createHmac } from 'node:crypto';

export default (moe) => {
  const wanted = () =>
    new Set(
      String(moe.settings.get('ereignisse') ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    );

  moe.on('file.*', async (event) => {
    if (!wanted().has(event.action)) return;
    const actor = event.actorId ? moe.users.get(event.actorId) : null;
    const body = JSON.stringify({
      event: event.action,
      name: event.name,
      nodeId: event.nodeId,
      parentId: event.parentId,
      by: actor ? actor.username : null,
      viaLink: event.viaLink,
      at: new Date(event.at).toISOString(),
    });
    const headers = { 'content-type': 'application/json' };
    const secret = moe.settings.get('geheimnis');
    if (secret) headers['x-signature'] = createHmac('sha256', String(secret)).update(body).digest('hex');
    const response = await moe.fetch(String(moe.settings.get('url')), {
      method: 'POST',
      headers,
      body,
      timeout: 10_000,
      private: moe.settings.get('intern') === true,
    });
    moe.store.set('zuletzt', { at: Date.now(), status: response.status, event: event.action });
    if (!response.ok) throw new Error(`Die Adresse antwortet mit ${response.status}`);
  });

  moe.route('GET', '/zuletzt', () => moe.store.get('zuletzt') ?? {}, { admin: true });
};
