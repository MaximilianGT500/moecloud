import { BlockList, isIP } from 'node:net';

export interface Networks {
  entries: string[];
  invalid: string[];
  has(address: string): boolean;
}

export const NETWORK_LIMIT = 50;

export function plainAddress(address: string) {
  const text = String(address ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '');
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  return mapped ? mapped[1] : text;
}

const typeOf = (family: number) => (family === 4 ? 'ipv4' : 'ipv6');

export function parseNetworks(text: string): Networks {
  const list = new BlockList();
  const entries: string[] = [];
  const invalid: string[] = [];
  for (const item of String(text ?? '').split(/[\s,;]+/)) {
    if (!item) continue;
    const parts = item.split('/');
    const address = plainAddress(parts[0]);
    const family = isIP(address);
    if (!family || parts.length > 2) {
      invalid.push(item);
      continue;
    }
    if (parts.length === 1) {
      if (!entries.includes(address)) {
        list.addAddress(address, typeOf(family));
        entries.push(address);
      }
      continue;
    }
    const prefix = /^\d{1,3}$/.test(parts[1]) ? Number(parts[1]) : -1;
    if (prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
      invalid.push(item);
      continue;
    }
    const entry = `${address}/${prefix}`;
    if (!entries.includes(entry)) {
      list.addSubnet(address, prefix, typeOf(family));
      entries.push(entry);
    }
  }
  return {
    entries,
    invalid,
    has(candidate) {
      const address = plainAddress(candidate);
      const family = isIP(address);
      return family !== 0 && list.check(address, typeOf(family));
    },
  };
}
