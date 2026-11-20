import { HttpError, badRequest } from '../lib/errors.ts';
import { NETWORK_LIMIT, parseNetworks, plainAddress, type Networks } from '../lib/networks.ts';
import * as settings from './settings.ts';

let cached: { text: string; networks: Networks } | null = null;

export function adminNetworks() {
  const text = settings.get('security.adminNetworks');
  if (!cached || cached.text !== text) cached = { text, networks: parseNetworks(text) };
  return cached.networks;
}

export function adminReachable(address: string) {
  const networks = adminNetworks();
  return networks.entries.length === 0 || networks.has(address);
}

export const adminBlocked = () => new HttpError(403, 'Die Verwaltung ist von deiner Adresse aus nicht erreichbar', 'admin_network');

export function saveAdminNetworks(text: string, address: string) {
  const networks = parseNetworks(text);
  if (networks.invalid.length)
    throw badRequest('„{entry}“ ist keine Adresse und kein Netz. Schreib zum Beispiel 192.168.1.0/24 oder 203.0.113.7', {
      entry: networks.invalid[0].slice(0, 60),
    });
  if (networks.entries.length > NETWORK_LIMIT) throw badRequest('Mehr als {count} Einträge gehen nicht', { count: NETWORK_LIMIT });
  if (networks.entries.length && !networks.has(address))
    throw badRequest('Deine eigene Adresse {address} steht nicht in der Liste, du würdest dich aussperren', {
      address: plainAddress(address),
    });
  settings.set('security.adminNetworks', networks.entries.join('\n'));
  return networks.entries;
}
