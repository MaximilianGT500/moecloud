import { assertNoRansomware } from './ransomware.ts';
import { badRequest } from '../lib/errors.ts';
import * as settings from './settings.ts';

const VALID = /^[a-z0-9][a-z0-9+_-]{0,15}$/;
let parsed: { text: string; list: Set<string> } = { text: '', list: new Set() };

export const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
};

export function splitTypes(text: string) {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((entry) => entry.trim().toLowerCase().replace(/^\.+/, ''))
        .filter(Boolean)
    ),
  ].sort();
}

export const validTypes = (text: string) => splitTypes(text).every((entry) => VALID.test(entry)) && splitTypes(text).length <= 100;

export const cleanTypes = (text: string) => splitTypes(text).join(', ');

export function isBlockedName(name: string) {
  const text = settings.get('storage.blockedTypes');
  if (!text) return false;
  if (parsed.text !== text) parsed = { text, list: new Set(splitTypes(text)) };
  const extension = extensionOf(name.replace(/[.\s]+$/, ''));
  return Boolean(extension) && parsed.list.has(extension);
}

export function assertAllowedName(name: string) {
  assertNoRansomware(name);
  if (isBlockedName(name)) {
    throw badRequest('Dateien mit der Endung .{extension} sind auf diesem Server nicht erlaubt', { extension: extensionOf(name) });
  }
}
