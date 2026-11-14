export interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface CalendarEvent {
  title: string;
  start: Moment | null;
  end: Moment | null;
  location: string;
  description: string;
  repeats: boolean;
}

export interface Contact {
  name: string;
  organization: string;
  role: string;
  phones: { type: string; value: string }[];
  emails: string[];
  addresses: string[];
  urls: string[];
  birthday: string;
  note: string;
}

export interface Moment {
  time: number;
  allDay: boolean;
}

export function unfold(text: string) {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) lines[lines.length - 1] += line.slice(1);
    else if (line) lines.push(line);
  }
  return lines;
}

export function parseLine(line: string): Property | null {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    else if (line[index] === ':' && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon < 1) return null;
  const [head, ...parts] = line.slice(0, colon).split(';');
  const params: Record<string, string> = {};
  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals > 0) params[part.slice(0, equals).toUpperCase()] = part.slice(equals + 1).replace(/^"|"$/g, '');
  }
  return { name: head.replace(/^item\d+\./i, '').toUpperCase(), params, value: line.slice(colon + 1) };
}

export function blocks(text: string, type: string, limit = 2000) {
  const found: Property[][] = [];
  let current: Property[] | null = null;
  let depth = 0;
  for (const line of unfold(text)) {
    const property = parseLine(line);
    if (!property) continue;
    if (property.name === 'BEGIN') {
      if (current) depth++;
      else if (property.value.trim().toUpperCase() === type) current = [];
      continue;
    }
    if (property.name === 'END' && current) {
      if (depth > 0) depth--;
      else {
        found.push(current);
        current = null;
        if (found.length >= limit) break;
      }
      continue;
    }
    if (current && depth === 0) current.push(property);
  }
  return found;
}

export const unescapeText = (value: string) => value.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');

const first = (list: Property[], name: string) => list.find((entry) => entry.name === name);

function zoneOffset(time: number, zone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(new Date(time))
      .map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - time;
}

export function moment(property: Property | undefined): Moment | null {
  if (!property) return null;
  const value = property.value.trim();
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (day) return { time: new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime(), allDay: true };
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!full) return null;
  const [year, month, date, hour, minute, second] = full.slice(1, 7).map((part) => Number(part ?? 0));
  if (full[7]) return { time: Date.UTC(year, month - 1, date, hour, minute, second), allDay: false };
  const wall = Date.UTC(year, month - 1, date, hour, minute, second);
  if (property.params.TZID) {
    try {
      const guess = wall - zoneOffset(wall, property.params.TZID);
      return { time: wall - zoneOffset(guess, property.params.TZID), allDay: false };
    } catch {}
  }
  return { time: new Date(year, month - 1, date, hour, minute, second).getTime(), allDay: false };
}

export function parseCalendar(text: string): CalendarEvent[] {
  return blocks(text, 'VEVENT')
    .map((list) => ({
      title: unescapeText(first(list, 'SUMMARY')?.value ?? '').trim(),
      start: moment(first(list, 'DTSTART')),
      end: moment(first(list, 'DTEND')),
      location: unescapeText(first(list, 'LOCATION')?.value ?? '').trim(),
      description: unescapeText(first(list, 'DESCRIPTION')?.value ?? '').trim(),
      repeats: Boolean(first(list, 'RRULE')),
    }))
    .sort((a, b) => (a.start?.time ?? Infinity) - (b.start?.time ?? Infinity));
}

const typeOf = (property: Property) =>
  (property.params.TYPE ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .find((entry) => ['cell', 'home', 'work', 'fax', 'voice', 'main'].includes(entry)) ?? '';

export function parseContacts(text: string): Contact[] {
  return blocks(text, 'VCARD').map((list) => {
    const structured = (first(list, 'N')?.value ?? '').split(';').map(unescapeText);
    const name = unescapeText(first(list, 'FN')?.value ?? '').trim() || [structured[1], structured[0]].filter(Boolean).join(' ').trim();
    return {
      name,
      organization: unescapeText((first(list, 'ORG')?.value ?? '').split(';')[0]).trim(),
      role: unescapeText(first(list, 'TITLE')?.value ?? '').trim(),
      phones: list
        .filter((entry) => entry.name === 'TEL')
        .map((entry) => ({ type: typeOf(entry), value: entry.value.replace(/^tel:/i, '').trim() }))
        .filter((entry) => entry.value),
      emails: list
        .filter((entry) => entry.name === 'EMAIL')
        .map((entry) => entry.value.replace(/^mailto:/i, '').trim())
        .filter(Boolean),
      addresses: list
        .filter((entry) => entry.name === 'ADR')
        .map((entry) =>
          entry.value
            .split(';')
            .map((part) => unescapeText(part).trim())
            .filter(Boolean)
            .join(', ')
        )
        .filter(Boolean),
      urls: list
        .filter((entry) => entry.name === 'URL')
        .map((entry) => unescapeText(entry.value).trim())
        .filter((entry) => /^https?:\/\//i.test(entry)),
      birthday: (first(list, 'BDAY')?.value ?? '').trim(),
      note: unescapeText(first(list, 'NOTE')?.value ?? '').trim(),
    };
  });
}
