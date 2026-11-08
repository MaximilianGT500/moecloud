import { randomId, safeEqual } from '../lib/crypto.ts';
import { badRequest, forbidden } from '../lib/errors.ts';
import { Limiter } from '../lib/limiter.ts';
import type { Lang } from '../lib/i18n.ts';
import * as settings from './settings.ts';
import { createUser, userCount } from './users.ts';

const attempts = new Limiter(20, 15 * 60 * 1000);

export const isSetUp = () => settings.get('setup.done') || userCount() > 0;

export function setupCode(): string {
  if (isSetUp()) return '';
  let code = settings.get('setup.code');
  if (!code) {
    code = randomId(12);
    settings.set('setup.code', code);
  }
  return code;
}

export function renewSetupCode() {
  settings.set('setup.code', '');
  return setupCode();
}

export function checkCode(ip: string, code: unknown) {
  if (isSetUp()) throw forbidden('MoeCloud ist schon eingerichtet');
  attempts.check(ip);
  if (typeof code !== 'string' || !safeEqual(code.trim(), setupCode())) {
    attempts.hit(ip);
    throw badRequest('Der Einrichtungscode stimmt nicht, du findest ihn im Log des Servers');
  }
}

export interface SetupInput {
  code: string;
  siteName: string;
  siteUrl: string;
  language: Lang;
  seed: string;
  palette: settings.Palette;
  registration: settings.Registration;
  defaultQuota: number;
  admin: { username: string; name: string; email?: string; password: string };
}

export async function completeSetup(ip: string, input: SetupInput) {
  checkCode(ip, input.code);
  const user = await createUser({
    username: input.admin.username,
    name: input.admin.name,
    email: input.admin.email || null,
    password: input.admin.password,
    role: 'admin',
    language: input.language,
  });
  settings.setMany({
    'site.name': input.siteName,
    'site.url': input.siteUrl.replace(/\/+$/, ''),
    'site.language': input.language,
    'site.seed': input.seed,
    'site.palette': input.palette,
    'auth.registration': input.registration,
    'storage.defaultQuota': input.defaultQuota,
    'setup.done': true,
    'setup.code': '',
  });
  settings.secret();
  return user;
}
