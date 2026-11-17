import { all, one, run } from '../lib/db.ts';
import { randomId } from '../lib/crypto.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import type { LinkRow } from './links.ts';
import type { NodeRow } from './nodes.ts';
import { notifyAdmins } from './notify.ts';
import * as settings from './settings.ts';
import { getUser } from './users.ts';

export const REPORT_REASONS = ['illegal', 'malware', 'copyright', 'privacy', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

interface ReportRow {
  id: string;
  link_id: string | null;
  owner_id: number | null;
  label: string;
  reason: ReportReason;
  text: string | null;
  contact: string | null;
  created_at: number;
  resolved_at: number | null;
}

export function createReport(link: LinkRow, node: NodeRow, input: { reason: ReportReason; text?: string | null; contact?: string | null }) {
  if (!settings.get('share.reports')) throw forbidden('Melden ist auf diesem Server ausgeschaltet');
  const id = randomId();
  const label = link.label || node.name;
  run(
    'INSERT INTO reports (id, link_id, owner_id, label, reason, text, contact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    link.id,
    link.owner_id,
    label,
    input.reason,
    input.text?.trim() || null,
    input.contact?.trim() || null,
    Date.now()
  );
  notifyAdmins('admin_report', { label, reason: input.reason, owner: getUser(link.owner_id)?.name ?? '' }, '/admin/links');
  return id;
}

export function listReports() {
  return all<ReportRow & { paused: number | null; token: string | null; slug: string | null }>(
    `SELECT r.*, l.paused, l.token, l.slug FROM reports r LEFT JOIN links l ON l.id = r.link_id
     WHERE r.resolved_at IS NULL ORDER BY r.created_at DESC LIMIT 200`
  ).map((row) => {
    const owner = row.owner_id ? getUser(row.owner_id) : null;
    return {
      id: row.id,
      linkId: row.link_id,
      path: row.token ? `/s/${row.slug ?? row.token}` : null,
      paused: Boolean(row.paused),
      label: row.label,
      owner: owner ? { id: owner.id, name: owner.name, username: owner.username } : null,
      reason: row.reason,
      text: row.text,
      contact: row.contact,
      createdAt: Number(row.created_at),
    };
  });
}

export const openReports = () => Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE resolved_at IS NULL')?.n ?? 0);

export function resolveReport(id: string, pause: boolean) {
  const report = one<ReportRow>('SELECT * FROM reports WHERE id = ? AND resolved_at IS NULL', id);
  if (!report) throw notFound('Diese Meldung gibt es nicht mehr');
  if (pause && report.link_id) run('UPDATE links SET paused = 1 WHERE id = ?', report.link_id);
  run('UPDATE reports SET resolved_at = ? WHERE id = ?', Date.now(), id);
  return report;
}

export const purgeReports = (now = Date.now()) =>
  run('DELETE FROM reports WHERE resolved_at IS NOT NULL AND resolved_at < ?', now - 180 * 86_400_000).changes;
