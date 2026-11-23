import { HttpError } from '../lib/errors.ts';
import { one, run } from '../lib/db.ts';
import { ransomwareName } from '../lib/ransomware.ts';
import { audit } from './audit.ts';
import { notify, notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';
import type { UserRow } from './users.ts';

export const BURST_WINDOW = 10 * 60 * 1000;
const NOTICE_GAP = 60 * 60 * 1000;

const changes = new Map<string, number[]>();
const noticed = new Map<string, number>();

export const isRansomwareName = (name: string) => Boolean(settings.get('security.ransomware')) && ransomwareName(name);

export function assertNoRansomware(name: string) {
  if (isRansomwareName(name)) {
    throw new HttpError(403, '„{name}“ sieht nach einem Erpressungstrojaner aus. Solche Dateien nimmt MoeCloud nicht an', 'ransomware', {
      name: name.slice(0, 120),
    });
  }
}

export const devicePaused = () =>
  new HttpError(
    403,
    'Dieses App-Passwort ist angehalten, weil darüber in kurzer Zeit sehr viele Dateien geändert wurden. Gib es unter Konto › App-Passwörter wieder frei',
    'device_paused'
  );

export function burstLimit() {
  const value = Number(settings.get('security.burstLimit'));
  return Number.isFinite(value) ? Math.min(10_000, Math.max(20, Math.floor(value))) : 300;
}

export function resetBurst(appId?: string) {
  if (appId) {
    changes.delete(appId);
    noticed.delete(appId);
  } else {
    changes.clear();
    noticed.clear();
  }
}

export function noteDeviceChange(user: UserRow, appId: string | undefined, now = Date.now()): 'ok' | 'paused' {
  if (!appId || !settings.get('security.burst')) return 'ok';
  const list = (changes.get(appId) ?? []).filter((time) => time > now - BURST_WINDOW);
  list.push(now);
  changes.set(appId, list);
  if (changes.size > 10_000) {
    for (const [key, times] of changes) if (!times.some((time) => time > now - BURST_WINDOW)) changes.delete(key);
  }
  const limit = burstLimit();
  if (list.length < limit) return 'ok';
  const pause = settings.get('security.burstPause');
  changes.set(appId, []);
  const row = one<{ name: string; paused_at: number | null }>(
    'SELECT name, paused_at FROM app_passwords WHERE id = ? AND user_id = ?',
    appId,
    user.id
  );
  if (!row) return 'ok';
  if (pause) {
    run(
      'UPDATE app_passwords SET paused_at = ?, paused_reason = ? WHERE id = ?',
      now,
      JSON.stringify({ count: list.length, since: list[0] }),
      appId
    );
  }
  if ((noticed.get(appId) ?? 0) < now - NOTICE_GAP || pause) {
    noticed.set(appId, now);
    const params = { name: row.name, count: list.length, paused: pause ? 1 : 0, user: user.name };
    notify(user.id, 'device_burst', params, '/account#app-passwoerter');
    notifyAdmins('admin_burst', params, '/admin/audit', user.id);
    audit('device_burst', { actor: user.id, details: { appPassword: row.name, count: list.length, paused: pause } });
  }
  return pause ? 'paused' : 'ok';
}
