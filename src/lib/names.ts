import { badRequest } from './errors.ts';

const FORBIDDEN = /[/\\\u0000-\u001f\u007f]/;

export function cleanName(input: unknown): string {
  const name = String(input ?? '')
    .normalize('NFC')
    .trim();
  if (!name) throw badRequest('Gib einen Namen ein');
  if (name === '.' || name === '..') throw badRequest('Dieser Name ist nicht erlaubt');
  if (FORBIDDEN.test(name)) throw badRequest('Der Name darf keine Schrägstriche oder Steuerzeichen enthalten');
  if (Buffer.byteLength(name) > 255) throw badRequest('Der Name ist zu lang, nimm höchstens 255 Zeichen');
  return name;
}

export const nameKey = (name: string) => name.normalize('NFC').toLowerCase();

const DOUBLE = /\.(tar\.(gz|bz2|xz|zst))$/i;

export function splitName(name: string): [string, string] {
  const double = DOUBLE.exec(name);
  if (double && double.index > 0) return [name.slice(0, double.index), name.slice(double.index)];
  const index = name.lastIndexOf('.');
  if (index <= 0) return [name, ''];
  return [name.slice(0, index), name.slice(index)];
}

export function numbered(name: string, n: number, folder = false): string {
  if (folder) return `${name} (${n})`;
  const [base, ext] = splitName(name);
  return `${base} (${n})${ext}`;
}

export function uniqueName(name: string, folder: boolean, taken: (key: string) => boolean): string {
  if (!taken(nameKey(name))) return name;
  for (let n = 2; n < 10_000; n++) {
    const candidate = numbered(name, n, folder);
    if (!taken(nameKey(candidate))) return candidate;
  }
  throw badRequest('Es gibt zu viele Dateien mit diesem Namen');
}

export function cleanRelativePath(input: unknown): string[] {
  if (input === undefined || input === null || input === '') return [];
  const parts = String(input)
    .split(/[/\\]+/)
    .filter((part) => part && part !== '.');
  if (parts.length > 64) throw badRequest('Die Ordnerstruktur ist zu tief');
  return parts.map(cleanName);
}
