import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

async function bodyOf(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export async function fakeCollabora(payload: Buffer) {
  const saves: { status: number; body: string }[] = [];
  let base = '';
  const server: Server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', base);
      if (url.pathname === '/hosting/discovery') {
        const source = `${base}/browser/test/cool.html?`;
        const actions = ['odt', 'docx', 'xlsx', 'pptx'].map(
          (extension) => `<action default="true" ext="${extension}" name="edit" urlsrc="${source}"/>`
        );
        response.writeHead(200, { 'content-type': 'text/xml' });
        response.end(
          `<?xml version="1.0"?><wopi-discovery><net-zone name="external-http"><app name="writer">${actions.join('')}</app></net-zone></wopi-discovery>`
        );
        return;
      }
      if (url.pathname === '/browser/test/cool.html' && request.method === 'POST') {
        const form = (await bodyOf(request)).toString('utf8');
        const token = /name="access_token"\r\n\r\n([^\r\n]*)/.exec(form)?.[1] ?? '';
        const ttl = /name="access_token_ttl"\r\n\r\n([^\r\n]*)/.exec(form)?.[1] ?? '';
        const source = url.searchParams.get('WOPISrc') ?? '';
        const check = await fetch(`${source}?access_token=${encodeURIComponent(token)}`);
        if (!check.ok) {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(`<p id="state">CheckFileInfo ${check.status}</p>`);
          return;
        }
        const info = (await check.json()) as Record<string, unknown>;
        const content = Buffer.from(await (await fetch(`${source}/contents?access_token=${encodeURIComponent(token)}`)).arrayBuffer());
        const data = { source, token, origin: String(info.PostMessageOrigin ?? ''), modified: String(info.LastModifiedTime ?? '') };
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Office</title></head><body>
<h1 id="name">${escape(String(info.BaseFileName))}</h1>
<p id="user">${escape(String(info.UserFriendlyName))}</p>
<p id="write">${info.UserCanWrite ? 'schreiben' : 'lesen'}</p>
<p id="size">${content.length}</p>
<p id="ttl">${escape(ttl)}</p>
<p id="mode">${escape(url.searchParams.get('permission') ?? 'edit')} ${escape(url.searchParams.get('lang') ?? '')} ${escape(url.searchParams.get('closebutton') ?? '')}</p>
<p id="state">lädt</p>
<button id="save" type="button">Speichern</button>
<button id="close" type="button">Schließen</button>
<script>
const data = ${JSON.stringify(data)};
const state = document.getElementById('state');
const post = (id, values) => parent.postMessage(JSON.stringify({ MessageId: id, SendTime: Date.now(), Values: values || {} }), data.origin);
addEventListener('message', (event) => {
  if (event.origin !== data.origin) return;
  const message = JSON.parse(event.data);
  if (message.MessageId === 'Host_PostmessageReady' && state.textContent === 'lädt') {
    state.textContent = 'bereit';
    post('App_LoadingStatus', { Status: 'Document_Loaded', DocumentLoadedTime: Date.now() });
  }
});
post('App_LoadingStatus', { Status: 'Initialized' });
post('App_LoadingStatus', { Status: 'Frame_Ready' });
document.getElementById('save').addEventListener('click', async () => {
  const result = await fetch('/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const body = await result.json();
  if (body.modified) data.modified = body.modified;
  state.textContent = result.ok ? 'gespeichert' : 'Fehler ' + result.status;
});
document.getElementById('close').addEventListener('click', () => post('UI_Close', { EverModified: true }));
</script></body></html>`);
        return;
      }
      if (url.pathname === '/save' && request.method === 'POST') {
        const data = JSON.parse((await bodyOf(request)).toString('utf8')) as { source: string; token: string; modified: string };
        const saved = await fetch(`${data.source}/contents?access_token=${encodeURIComponent(data.token)}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'x-wopi-override': 'PUT',
            'x-cool-wopi-timestamp': data.modified,
            'x-cool-wopi-ismodifiedbyuser': 'true',
            'x-cool-wopi-isautosave': 'false',
          },
          body: new Uint8Array(payload),
        });
        const text = await saved.text();
        saves.push({ status: saved.status, body: text });
        let modified = '';
        try {
          modified = String((JSON.parse(text) as { LastModifiedTime?: string }).LastModifiedTime ?? '');
        } catch {
          modified = '';
        }
        response.writeHead(saved.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ modified }));
        return;
      }
      response.writeHead(404).end();
    })().catch((error: Error) => {
      response.writeHead(500, { 'content-type': 'text/plain' });
      response.end(error.message);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url: base, saves, close: () => new Promise((resolve) => server.close(resolve)) };
}
