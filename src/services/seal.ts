import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { secret } from './settings.ts';

const VERSION = 'v1';

const keyFor = (purpose: string) => createHash('sha256').update(`${secret()}\u0000${purpose}`).digest();

export function seal(text: string, purpose: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(purpose), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function unseal(token: string, purpose: string) {
  const [version, iv, tag, data] = token.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('sealed-format');
  const decipher = createDecipheriv('aes-256-gcm', keyFor(purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
