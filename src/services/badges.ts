import { publish } from '../lib/events.ts';
import { appAllowed } from './apps.ts';
import type { UserRow } from './users.ts';

export type BadgeKey = 'mail' | 'chat' | 'feeds';

type Counter = (user: UserRow) => number | Promise<number>;

const counters = new Map<BadgeKey, Counter>();

export const countBadge = (key: BadgeKey, counter: Counter) => {
  counters.set(key, counter);
};

export async function badgesFor(user: UserRow) {
  const result: Record<BadgeKey, number> = { mail: 0, chat: 0, feeds: 0 };
  await Promise.all(
    [...counters].map(async ([key, counter]) => {
      if (!appAllowed(key, user)) return;
      try {
        result[key] = Math.max(0, Math.floor(await counter(user)));
      } catch {
        result[key] = 0;
      }
    })
  );
  return result;
}

export const pushBadge = (userIds: Iterable<number>, patch: Partial<Record<BadgeKey, number>>) => publish(userIds, 'badges', patch);
