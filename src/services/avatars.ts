import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config.ts';
import { randomId } from '../lib/crypto.ts';
import { run } from '../lib/db.ts';
import { badRequest, tooLarge } from '../lib/errors.ts';
import { loadSharp } from '../lib/sharp.ts';
import type { UserRow } from './users.ts';

const MAX_BYTES = 6 * 1024 * 1024;
const SIZE = 256;

export const avatarPath = (userId: number) => join(config.paths.avatars, `${userId}.webp`);

export async function readLimited(stream: Readable, limit = MAX_BYTES) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > limit) throw tooLarge('Das Bild ist zu groß, höchstens 6 MB');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function setAvatar(user: UserRow, image: Buffer) {
  if (image.length === 0) throw badRequest('Wähl ein Bild aus');
  if (image.length > MAX_BYTES) throw tooLarge('Das Bild ist zu groß, höchstens 6 MB');
  const sharp = await loadSharp();
  let output: Buffer;
  try {
    output = await sharp(image, { failOn: 'error', limitInputPixels: 60_000_000, animated: false })
      .rotate()
      .resize(SIZE, SIZE, { fit: 'cover', position: 'centre' })
      .flatten({ background: '#ffffff' })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    throw badRequest('Das Bild ließ sich nicht lesen. Nimm ein JPEG, PNG oder WebP');
  }
  await mkdir(config.paths.avatars, { recursive: true });
  await writeFile(avatarPath(user.id), output);
  const stamp = randomId(8);
  run('UPDATE users SET avatar = ? WHERE id = ?', stamp, user.id);
  return stamp;
}

export async function removeAvatar(userId: number) {
  run('UPDATE users SET avatar = NULL WHERE id = ?', userId);
  await rm(avatarPath(userId), { force: true });
}

export async function avatarFile(user: Pick<UserRow, 'id' | 'avatar'>) {
  if (!user.avatar) return null;
  try {
    const info = await stat(avatarPath(user.id));
    return { path: avatarPath(user.id), size: info.size, modified: info.mtimeMs, stamp: user.avatar };
  } catch {
    return null;
  }
}
