import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return !blocked.check(mapped[1], 'ipv4');
  return !blocked.check(address, 'ipv6');
}

export const guardedLookup =
  (allowPrivate: () => boolean): LookupFunction =>
  (hostname, options, callback) => {
    lookup(hostname, { all: true, order: 'verbatim' })
      .then((addresses) => {
        if (addresses.length === 0) throw new Error('ENOTFOUND');
        if (!allowPrivate() && addresses.some((entry) => !isPublicAddress(entry.address))) {
          throw Object.assign(new Error('Die Adresse zeigt ins lokale Netz'), { code: 'MOE_PRIVATE' });
        }
        const wanted =
          typeof options === 'object' && options.family ? addresses.filter((entry) => entry.family === options.family) : addresses;
        const chosen = wanted[0] ?? addresses[0];
        if (typeof options === 'object' && options.all) callback(null, wanted.length ? wanted : addresses);
        else callback(null, chosen.address, chosen.family);
      })
      .catch((error: NodeJS.ErrnoException) => callback(error, '', 0));
  };

export function privateLiteral(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return Boolean(isIP(host)) && !isPublicAddress(host);
}
