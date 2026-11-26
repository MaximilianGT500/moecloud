export interface Timed {
  start: number;
  end: number;
}

export interface Placed<T> {
  item: T;
  top: number;
  bottom: number;
  left: number;
  width: number;
  z: number;
  stacked: boolean;
}

const NEAR = 30;
const INDENT = 0.14;

export function layoutDay<T extends Timed>(
  items: T[],
  minuteOf: (utc: number) => number,
  dayStart: number,
  dayEnd: number,
  minimum: number
): Placed<T>[] {
  const entries = items
    .map((item) => {
      const top = item.start <= dayStart ? 0 : minuteOf(item.start);
      let bottom = item.end >= dayEnd ? 1440 : minuteOf(item.end);
      if (bottom <= top) bottom = Math.min(1440, top + minimum);
      return { item, top, bottom, visual: Math.min(1440, Math.max(bottom, top + minimum)) };
    })
    .sort((a, b) => a.top - b.top || b.bottom - b.top - (a.bottom - a.top));
  interface Group {
    indent: number;
    members: typeof entries;
  }
  const groups: Group[] = [];
  const placed: { entry: (typeof entries)[number]; group: Group }[] = [];
  for (const entry of entries) {
    const overlapping = placed.filter(({ entry: other }) => other.top < entry.visual && other.visual > entry.top);
    const near = overlapping.find(({ entry: other }) => entry.top - other.top < NEAR);
    if (near) {
      near.group.members.push(entry);
      placed.push({ entry, group: near.group });
      continue;
    }
    const indent = overlapping.length ? Math.max(...overlapping.map(({ group }) => group.indent)) + 1 : 0;
    const group: Group = { indent, members: [entry] };
    groups.push(group);
    placed.push({ entry, group });
  }
  const out: Placed<T>[] = [];
  groups.forEach((group, order) => {
    const offset = Math.min(group.indent, 4) * INDENT;
    const share = (1 - offset) / group.members.length;
    group.members.forEach((entry, index) => {
      out.push({
        item: entry.item,
        top: entry.top,
        bottom: entry.bottom,
        left: offset + index * share,
        width: share,
        z: order + 1,
        stacked: group.indent > 0,
      });
    });
  });
  return out;
}

export interface Bar<T> {
  item: T;
  first: number;
  last: number;
  lane: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

export function layoutBars<T>(items: T[], days: string[], spanOf: (item: T) => [string, string]): { bars: Bar<T>[]; lanes: number } {
  const index = new Map(days.map((day, position) => [day, position]));
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const prepared = items
    .map((item) => {
      const [from, to] = spanOf(item);
      if (to < firstDay || from > lastDay) return null;
      const first = from < firstDay ? 0 : (index.get(from) ?? nearest(days, from));
      const last = to > lastDay ? days.length - 1 : (index.get(to) ?? nearest(days, to, true));
      if (last < first) return null;
      return { item, first, last, clippedStart: from < firstDay, clippedEnd: to > lastDay };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((a, b) => a.first - b.first || b.last - b.first - (a.last - a.first));
  const lanes: number[] = [];
  const bars: Bar<T>[] = [];
  for (const entry of prepared) {
    let lane = lanes.findIndex((end) => end < entry.first);
    if (lane < 0) {
      lane = lanes.length;
      lanes.push(entry.last);
    } else lanes[lane] = entry.last;
    bars.push({ ...entry, lane });
  }
  return { bars, lanes: lanes.length };
}

function nearest(days: string[], key: string, backwards = false) {
  if (backwards) {
    for (let position = days.length - 1; position >= 0; position--) if (days[position] <= key) return position;
    return -1;
  }
  for (let position = 0; position < days.length; position++) if (days[position] >= key) return position;
  return days.length;
}
