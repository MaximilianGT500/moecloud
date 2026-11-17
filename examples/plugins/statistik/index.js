const DAY = 86_400_000;
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);
const keyOf = (userId, day) => `tag:${userId}:${day}`;

export default (moe) => {
  moe.on('file.*', (event) => {
    const userId = event.actorId ?? event.ownerId;
    if (!userId) return;
    const key = keyOf(userId, dayOf(event.at));
    const counts = moe.store.get(key) ?? {};
    counts[event.action] = (counts[event.action] ?? 0) + 1;
    moe.store.set(key, counts);
  });

  moe.job('aufraeumen', '1d', () => {
    const oldest = dayOf(Date.now() - Number(moe.settings.get('tage') ?? 90) * DAY);
    for (const key of moe.store.keys('tag:')) {
      if (key.split(':')[2] < oldest) moe.store.delete(key);
    }
  });

  moe.route('GET', '/tage', (request) => {
    const span = Math.min(90, Math.max(7, Number(request.query.tage) || 14));
    const days = [];
    for (let back = span - 1; back >= 0; back -= 1) {
      const day = dayOf(Date.now() - back * DAY);
      days.push({ day, counts: moe.store.get(keyOf(request.user.id, day)) ?? {} });
    }
    return { days };
  });
};
