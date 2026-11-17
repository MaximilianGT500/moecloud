import { timingSafeEqual } from 'node:crypto';

function same(given, expected) {
  const left = Buffer.from(String(given));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

export default (moe) => {
  const receive = async (request, reply) => {
    const token = String(moe.settings.get('token') ?? '');
    if (token.length < 16 || !same(request.params.token, token)) {
      reply.status(404);
      return { error: 'Diese Adresse gibt es nicht' };
    }
    if (!request.rawBody || request.rawBody.length === 0) {
      reply.status(400);
      return { error: 'Die Anfrage enthält keine Datei' };
    }
    const username = String(moe.settings.get('konto') ?? '')
      .trim()
      .toLowerCase();
    const user = moe.users.list().find((entry) => entry.username === username);
    if (!user) {
      reply.status(503);
      return { error: 'Das Konto für den Briefkasten gibt es nicht' };
    }
    const folder = moe.files.folder(user.id, null, String(moe.settings.get('ordner') || 'Briefkasten'));
    const file = await moe.files.write(user.id, folder.id, request.params.name, request.rawBody);
    if (moe.settings.get('melden') !== false) {
      moe.notify(user.id, {
        title: user.language === 'en' ? 'New file in the drop box' : 'Neue Datei im Briefkasten',
        text: file.name,
        url: `/files/folder/${folder.id}`,
      });
    }
    reply.status(201);
    return { name: file.name, size: file.size };
  };

  moe.publicRoute('PUT', '/:token/:name', receive);
  moe.publicRoute('POST', '/:token/:name', receive);
};
