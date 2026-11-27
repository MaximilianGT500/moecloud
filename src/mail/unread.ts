import { all, run } from '../lib/db.ts';
import { log } from '../lib/log.ts';
import { appEnabled } from '../services/apps.ts';
import { countBadge, pushBadge } from '../services/badges.ts';
import { notify } from '../services/notify.ts';
import { getUser, prefsOf, type UserRow } from '../services/users.ts';
import { listAccounts, type MailAccountRow } from './accounts.ts';
import { inboxStatus, newSince } from './imap.ts';

const FRESH = 60_000;
const known = new Map<string, { at: number; unseen: number }>();

export function noteUnread(accountId: string, unseen: number) {
  known.set(accountId, { at: Date.now(), unseen });
}

export const forgetUnread = (accountId: string) => known.delete(accountId);

async function unseenOf(row: MailAccountRow) {
  const cached = known.get(row.id);
  if (cached && Date.now() - cached.at < FRESH) return cached.unseen;
  const status = await inboxStatus(row);
  noteUnread(row.id, status.unseen);
  return status.unseen;
}

export async function unreadByAccount(user: Pick<UserRow, 'id'>) {
  const result: Record<string, number> = {};
  await Promise.all(
    listAccounts(user).map(async (row) => {
      try {
        result[row.id] = await unseenOf(row);
      } catch {
        result[row.id] = known.get(row.id)?.unseen ?? 0;
      }
    })
  );
  return result;
}

export async function unreadTotal(user: Pick<UserRow, 'id'>) {
  return Object.values(await unreadByAccount(user)).reduce((sum, count) => sum + count, 0);
}

countBadge('mail', unreadTotal);

export async function refreshBadge(userId: number) {
  pushBadge([userId], { mail: await unreadTotal({ id: userId }) });
}

let checking = false;

export async function checkNewMail() {
  if (checking || !appEnabled('mail')) return 0;
  checking = true;
  let notified = 0;
  try {
    const rows = all<MailAccountRow>(
      "SELECT a.* FROM mail_accounts a JOIN users u ON u.id = a.user_id WHERE u.role IN ('user', 'admin') AND u.disabled = 0 AND u.pending = 0 ORDER BY a.checked_at"
    );
    const touched = new Set<number>();
    for (const row of rows) {
      try {
        const status = await inboxStatus(row);
        noteUnread(row.id, status.unseen);
        const latest = Math.max(0, status.uidNext - 1);
        if (row.seen_validity !== status.validity || row.seen_uid === null) {
          run(
            'UPDATE mail_accounts SET seen_uid = ?, seen_validity = ?, checked_at = ? WHERE id = ?',
            latest,
            status.validity,
            Date.now(),
            row.id
          );
          continue;
        }
        if (latest <= row.seen_uid) continue;
        const fresh = await newSince(row, row.seen_uid);
        run('UPDATE mail_accounts SET seen_uid = ?, checked_at = ? WHERE id = ?', latest, Date.now(), row.id);
        touched.add(row.user_id);
        const user = getUser(row.user_id);
        if (!fresh.count || !row.notify || !user || !prefsOf(user).pushMail) continue;
        const first = fresh.items[0];
        notify(
          row.user_id,
          'mail_new',
          {
            count: fresh.count,
            account: row.name,
            from: first?.from[0]?.name || first?.from[0]?.address || '?',
            subject:
              fresh.count > 1
                ? fresh.items
                    .map((item) => item.subject)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join(' · ') || ''
                : (first?.subject ?? ''),
          },
          first ? `/mail?account=${row.id}&folder=INBOX&uid=${first.uid}` : `/mail?account=${row.id}`,
          { mail: false }
        );
        notified++;
      } catch (error) {
        log.debug({ error: (error as Error).message, account: row.id }, 'Neue E-Mails ließen sich nicht abrufen');
      }
    }
    for (const userId of touched) await refreshBadge(userId).catch(() => undefined);
  } finally {
    checking = false;
  }
  return notified;
}
