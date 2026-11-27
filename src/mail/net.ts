import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from '../lib/errors.ts';
import { isPublicAddress } from '../lib/netguard.ts';
import * as settings from '../services/settings.ts';

export type Security = 'tls' | 'starttls' | 'none';

export interface Endpoint {
  host: string;
  port: number;
  security: Security;
}

const PORTS = { imap: [143, 993], smtp: [25, 465, 587, 2525] } as const;

const presetEndpoint = (kind: 'imap' | 'smtp', endpoint: Endpoint) => {
  const preset = settings.get('webmail.preset');
  if (!preset) return false;
  const known = preset[kind];
  return known.host.toLowerCase() === endpoint.host.toLowerCase() && known.port === endpoint.port;
};

export const lanAllowed = () => settings.get('webmail.private');

export function checkEndpoint(kind: 'imap' | 'smtp', endpoint: Endpoint) {
  const trusted = presetEndpoint(kind, endpoint);
  if (!trusted && !lanAllowed() && !(PORTS[kind] as readonly number[]).includes(endpoint.port)) {
    throw new HttpError(400, 'Der Port {port} ist für E-Mail nicht freigegeben', 'mail_port', { port: endpoint.port });
  }
  if (endpoint.security === 'none' && !trusted && !lanAllowed()) {
    throw new HttpError(400, 'Ohne Verschlüsselung geht das nur im lokalen Netz, wenn die Verwaltung das erlaubt', 'mail_plain');
  }
  return trusted;
}

export async function resolveEndpoint(kind: 'imap' | 'smtp', endpoint: Endpoint) {
  const trusted = checkEndpoint(kind, endpoint);
  const name = endpoint.host.replace(/^\[|\]$/g, '');
  const lan = trusted || lanAllowed();
  if (isIP(name)) {
    if (!lan && !isPublicAddress(name)) throw new HttpError(400, 'Mailserver im lokalen Netz sind gesperrt', 'mail_private');
    return { address: name, servername: undefined as string | undefined };
  }
  let addresses: { address: string }[] = [];
  try {
    addresses = await lookup(name, { all: true, order: 'verbatim' });
  } catch {
    addresses = [];
  }
  if (!addresses.length) throw new HttpError(400, 'Den Mailserver {host} gibt es nicht', 'mail_dns', { host: name });
  if (!lan && addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw new HttpError(400, 'Mailserver im lokalen Netz sind gesperrt', 'mail_private');
  }
  return { address: addresses[0].address, servername: name };
}

const TLS_CODES =
  /^(CERT_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT)/;

export function mailFailure(error: unknown, host: string): HttpError {
  if (error instanceof HttpError) return error;
  const known = error as {
    code?: string;
    authenticationFailed?: boolean;
    responseCode?: number;
    serverResponseCode?: string;
    response?: string;
    message?: string;
  };
  const code = String(known.code ?? '');
  if (known.authenticationFailed || code === 'EAUTH' || known.serverResponseCode === 'AUTHENTICATIONFAILED') {
    return new HttpError(400, 'Die Anmeldung beim Mailserver hat nicht geklappt, prüf Benutzername und Passwort', 'mail_auth');
  }
  if (TLS_CODES.test(code) || /certificate|self.signed/i.test(known.message ?? '')) {
    return new HttpError(424, 'Das Zertifikat des Mailservers {host} ist nicht gültig', 'mail_tls', { host });
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new HttpError(400, 'Den Mailserver {host} gibt es nicht', 'mail_dns', { host });
  if (
    [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'EPIPE',
      'ESOCKET',
      'ECONNECTION',
      'NoConnection',
      'ETIMEOUT',
    ].includes(code) ||
    /timeout|closed|connection not available/i.test(known.message ?? '')
  ) {
    return new HttpError(424, 'Der Mailserver {host} ist gerade nicht erreichbar', 'mail_unreachable', { host });
  }
  if (known.serverResponseCode === 'NONEXISTENT' || /doesn.t exist|nonexistent|unknown mailbox/i.test(known.response ?? '')) {
    return new HttpError(404, 'Diesen Ordner gibt es nicht', 'mail_folder');
  }
  if (known.responseCode && known.responseCode >= 500) {
    return new HttpError(424, 'Der Mailserver hat abgelehnt: {reason}', 'mail_rejected', {
      reason: String(known.response ?? known.message ?? '').slice(0, 200),
    });
  }
  return new HttpError(424, 'Der Mailserver hat die Anfrage abgelehnt', 'mail_failed');
}
