import { run, value } from '../lib/db.ts';
import * as settings from './settings.ts';
import { PERSON, type UserRow } from './users.ts';

export const termsText = () => settings.get('site.terms').trim();

export const termsActive = () => settings.get('terms.required') && Boolean(termsText()) && !/^https?:\/\//.test(termsText());

export const termsPending = (user: Pick<UserRow, 'terms_version'>) =>
  termsActive() && Number(user.terms_version ?? 0) < settings.get('terms.version');

export function acceptTerms(user: Pick<UserRow, 'id'>) {
  run('UPDATE users SET terms_version = ?, terms_at = ? WHERE id = ?', settings.get('terms.version'), Date.now(), user.id);
}

export function renewTerms(admin: Pick<UserRow, 'id'>) {
  settings.set('terms.version', settings.get('terms.version') + 1);
  acceptTerms(admin);
  return termsState();
}

export function ensureTermsVersion(admin: Pick<UserRow, 'id'>) {
  if (settings.get('terms.version') < 1) settings.set('terms.version', 1);
  acceptTerms(admin);
}

export function termsState() {
  const version = settings.get('terms.version');
  return {
    active: termsActive(),
    version,
    people: value<number>(`SELECT COUNT(*) FROM users WHERE ${PERSON} AND disabled = 0`) ?? 0,
    accepted:
      value<number>(`SELECT COUNT(*) FROM users WHERE ${PERSON} AND disabled = 0 AND terms_version >= ?`, Math.max(1, version)) ?? 0,
  };
}
