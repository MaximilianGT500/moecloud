export interface LiveClient {
  send: (event: string, data: unknown) => void;
}

const clients = new Map<number, Set<LiveClient>>();

export function subscribe(userId: number, client: LiveClient) {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(client);
  return () => {
    set.delete(client);
    if (set.size === 0) clients.delete(userId);
  };
}

export function publish(userIds: Iterable<number>, event: string, data: unknown) {
  for (const userId of new Set(userIds)) {
    for (const client of clients.get(userId) ?? []) {
      try {
        client.send(event, data);
      } catch {}
    }
  }
}

export const liveCount = () => [...clients.values()].reduce((sum, set) => sum + set.size, 0);
