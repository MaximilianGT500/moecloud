import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { badRequest } from '../lib/errors.ts';
import { request } from '../lib/fetch.ts';
import { log } from '../lib/log.ts';
import * as settings from './settings.ts';

export const passwordMin = () => Math.min(64, Math.max(10, settings.get('auth.passwordMin')));

export async function breached(password: string) {
  if (!config.breachUrl || config.breachUrl === 'off') return false;
  const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  try {
    const response = await request(`${config.breachUrl.replace(/\/+$/, '')}/${hash.slice(0, 5)}`, {
      timeout: 4000,
      maxBytes: 256 * 1024,
      headers: { 'Add-Padding': 'true' },
    });
    if (!response.ok) return false;
    return response.text.split(/\r?\n/).some((line) => {
      const [suffix, count] = line.trim().split(':');
      return suffix?.toUpperCase() === hash.slice(5) && Number(count) > 0;
    });
  } catch (error) {
    log.debug({ error: (error as Error).message }, 'Die Prüfung auf bekannte Passwörter ist nicht erreichbar');
    return false;
  }
}

export function checkPasswordLength(password: string) {
  const min = passwordMin();
  if ([...password].length < min) throw badRequest('Das Passwort braucht mindestens {count} Zeichen', { count: min });
}

export async function checkPassword(password: string) {
  checkPasswordLength(password);
  if (settings.get('auth.passwordBreach') && (await breached(password))) {
    throw badRequest('Dieses Passwort stand schon in einem Datenleck. Nimm ein anderes');
  }
}
