import { addDays, addMonths, daysInMonth, dateKey, parseKey, startOfWeek, weekdayOf } from './time.ts';

export interface QuickResult {
  title: string;
  date: string | null;
  start: number | null;
  end: number | null;
  duration: number | null;
  allDay: boolean;
  rrule: string | null;
  location: string | null;
  tags: string[];
  spans: { from: number; to: number; kind: 'date' | 'time' | 'repeat' | 'duration' | 'place' | 'tag' }[];
}

const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

const WEEKDAYS: [RegExp, number][] = [
  [/^(sonntag|sonntags|so\.|sunday|sundays|sun)$/u, 0],
  [/^(montag|montags|mo\.|monday|mondays|mon)$/u, 1],
  [/^(dienstag|dienstags|di\.|tuesday|tuesdays|tue|tues)$/u, 2],
  [/^(mittwoch|mittwochs|mi\.|wednesday|wednesdays|wed)$/u, 3],
  [/^(donnerstag|donnerstags|do\.|thursday|thursdays|thu|thurs)$/u, 4],
  [/^(freitag|freitags|fr\.|friday|fridays|fri)$/u, 5],
  [/^(samstag|samstags|sonnabend|sa\.|saturday|saturdays|sat)$/u, 6],
];

const WEEKDAY_WORDS =
  'sonntags?|montags?|dienstags?|mittwochs?|donnerstags?|freitags?|samstags?|sonnabends?|so\\.|mo\\.|di\\.|mi\\.|do\\.|fr\\.|sa\\.|sundays?|mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sun|mon|tues?|wed|thu(?:rs)?|fri|sat';

const MONTHS: [RegExp, number][] = [
  [/^(januar|jänner|january|jan)\.?$/u, 1],
  [/^(februar|february|feb)\.?$/u, 2],
  [/^(märz|maerz|march|mär|mar)\.?$/u, 3],
  [/^(april|apr)\.?$/u, 4],
  [/^(mai|may)$/u, 5],
  [/^(juni|june|jun)\.?$/u, 6],
  [/^(juli|july|jul)\.?$/u, 7],
  [/^(august|aug)\.?$/u, 8],
  [/^(september|sept|sep)\.?$/u, 9],
  [/^(oktober|october|okt|oct)\.?$/u, 10],
  [/^(november|nov)\.?$/u, 11],
  [/^(dezember|december|dez|dec)\.?$/u, 12],
];

const MONTH_WORDS =
  'januar|jänner|january|jan\\.?|februar|february|feb\\.?|märz|maerz|march|mär\\.?|mar\\.?|april|apr\\.?|mai|may|juni|june|jun\\.?|juli|july|jul\\.?|august|aug\\.?|september|sept\\.?|sep\\.?|oktober|october|okt\\.?|oct\\.?|november|nov\\.?|dezember|december|dez\\.?|dec\\.?';

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  a: 1,
  an: 1,
  one: 1,
  zwei: 2,
  two: 2,
  drei: 3,
  three: 3,
  vier: 4,
  four: 4,
  fünf: 5,
  five: 5,
  sechs: 6,
  six: 6,
  sieben: 7,
  seven: 7,
  acht: 8,
  eight: 8,
  neun: 9,
  nine: 9,
  zehn: 10,
  ten: 10,
};

const NUMBER =
  '(\\d+|ein|eine|einen|einem|einer|a|an|one|zwei|two|drei|three|vier|four|fünf|five|sechs|six|sieben|seven|acht|eight|neun|nine|zehn|ten)';

const numberOf = (value: string) => NUMBER_WORDS[value.toLowerCase()] ?? Number(value);

const weekdayOfWord = (word: string) => WEEKDAYS.find(([pattern]) => pattern.test(word.toLowerCase()))?.[1] ?? null;
const monthOfWord = (word: string) => MONTHS.find(([pattern]) => pattern.test(word.toLowerCase().replace(/\.$/, '')))?.[1] ?? null;

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function upcoming(today: string, weekday: number, skipToday: boolean) {
  const diff = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, diff === 0 && skipToday ? 7 : diff);
}

function validDate(year: number, month: number, day: number) {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function futureYear(today: string, month: number, day: number) {
  const { year } = parseKey(today);
  const candidate = dateKey(year, month, day);
  return candidate < today ? year + 1 : year;
}

function hour12(hour: number, meridiem: string | undefined) {
  if (!meridiem) return hour;
  const pm = meridiem.toLowerCase().startsWith('p');
  if (hour === 12) return pm ? 12 : 0;
  return pm ? hour + 12 : hour;
}

export function parseQuick(input: string, today: string, options: { weekStart?: number; nowMinutes?: number } = {}): QuickResult {
  const text = input;
  const lower = text.toLowerCase();
  const used: [number, number][] = [];
  const spans: QuickResult['spans'] = [];
  const free = (from: number, to: number) => used.every(([a, b]) => to <= a || from >= b);
  const take = (from: number, to: number, kind: QuickResult['spans'][number]['kind']) => {
    used.push([from, to]);
    spans.push({ from, to, kind });
  };
  const find = (pattern: string, kind: QuickResult['spans'][number]['kind'], handle: (match: RegExpExecArray) => boolean | void) => {
    const regex = new RegExp(pattern, 'giu');
    for (let match = regex.exec(lower); match; match = regex.exec(lower)) {
      if (!free(match.index, match.index + match[0].length)) continue;
      if (handle(match) === false) continue;
      take(match.index, match.index + match[0].length, kind);
      return true;
    }
    return false;
  };

  let date: string | null = null;
  let start: number | null = null;
  let end: number | null = null;
  let duration: number | null = null;
  let rrule: string | null = null;
  let location: string | null = null;
  const tags: string[] = [];
  const weekStart = options.weekStart ?? 1;

  for (let index = 0; index < 10; index++) {
    const found = find(`${B}#([\\p{L}\\p{N}_-]+)`, 'tag', (match) => {
      tags.push(text.slice(match.index + 1, match.index + match[0].length));
    });
    if (!found) break;
  }

  find(
    `${B}(?:jeden|jede|jedes|alle|every)\\s+(\\d+)\\.?\\s*(tage|tag|wochen|woche|monate|monat|jahre|jahr|days|day|weeks|week|months|month|years|year)${E}`,
    'repeat',
    (match) => {
      const interval = Number(match[1]);
      const unit = match[2];
      const freq = /^(tag|day)/.test(unit)
        ? 'DAILY'
        : /^(woche|week)/.test(unit)
          ? 'WEEKLY'
          : /^(monat|month)/.test(unit)
            ? 'MONTHLY'
            : 'YEARLY';
      rrule = `FREQ=${freq}${interval > 1 ? `;INTERVAL=${interval}` : ''}`;
    }
  );
  if (!rrule) {
    find(`${B}(?:jeden werktag|werktags|an werktagen|every weekday|weekdays|on weekdays)${E}`, 'repeat', () => {
      rrule = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    });
  }
  if (!rrule) {
    find(
      `${B}(?:jeden|jede|every|on)\\s+((?:${WEEKDAY_WORDS})(?:\\s*(?:,|und|and|&)\\s*(?:${WEEKDAY_WORDS}))*)${E}|${B}((?:montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags)(?:\\s*(?:,|und)\\s*(?:montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags))*)${E}`,
      'repeat',
      (match) => {
        const words = (match[1] ?? match[2]).split(/\s*(?:,|und|and|&)\s*/u).filter(Boolean);
        const days = words.map(weekdayOfWord).filter((value): value is number => value !== null);
        if (!days.length) return false;
        rrule = `FREQ=WEEKLY;BYDAY=${[...new Set(days)].map((day) => DAY_CODES[day]).join(',')}`;
        if (!date) date = upcoming(today, days[0], false);
      }
    );
  }
  if (!rrule) {
    find(`${B}(?:jeden tag|täglich|taeglich|every day|daily)${E}`, 'repeat', () => {
      rrule = 'FREQ=DAILY';
    });
  }
  if (!rrule) {
    find(`${B}(?:jede woche|wöchentlich|woechentlich|every week|weekly)${E}`, 'repeat', () => {
      rrule = 'FREQ=WEEKLY';
    });
  }
  if (!rrule) {
    find(`${B}(?:alle zwei wochen|zweiwöchentlich|every other week|biweekly|fortnightly)${E}`, 'repeat', () => {
      rrule = 'FREQ=WEEKLY;INTERVAL=2';
    });
  }
  if (!rrule) {
    find(`${B}(?:jeden monat|monatlich|every month|monthly)${E}`, 'repeat', () => {
      rrule = 'FREQ=MONTHLY';
    });
  }
  if (!rrule) {
    find(`${B}(?:jedes jahr|jährlich|jaehrlich|every year|yearly|annually)${E}`, 'repeat', () => {
      rrule = 'FREQ=YEARLY';
    });
  }

  find(`${B}(\\d{4})-(\\d{2})-(\\d{2})${E}`, 'date', (match) => {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (!validDate(year, month, day)) return false;
    date = dateKey(year, month, day);
  });
  if (!date) {
    find(`${B}(?:am\\s+|on\\s+)?(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?![\\d:])`, 'date', (match) => {
      const day = Number(match[1]);
      const month = Number(match[2]);
      let year = match[3] ? Number(match[3]) : futureYear(today, month, day);
      if (year < 100) year += 2000;
      if (!validDate(year, month, day)) return false;
      date = dateKey(year, month, day);
    });
  }
  if (!date) {
    find(
      `${B}(?:am\\s+|on\\s+|the\\s+)?(\\d{1,2})(?:\\.|st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_WORDS})(?:\\s+(\\d{4}))?${E}`,
      'date',
      (match) => {
        const day = Number(match[1]);
        const month = monthOfWord(match[2]);
        if (!month) return false;
        const year = match[3] ? Number(match[3]) : futureYear(today, month, day);
        if (!validDate(year, month, day)) return false;
        date = dateKey(year, month, day);
      }
    );
  }
  if (!date) {
    find(`${B}(?:on\\s+)?(${MONTH_WORDS})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}`, 'date', (match) => {
      const month = monthOfWord(match[1]);
      const day = Number(match[2]);
      if (!month) return false;
      const year = match[3] ? Number(match[3]) : futureYear(today, month, day);
      if (!validDate(year, month, day)) return false;
      date = dateKey(year, month, day);
    });
  }
  if (!date) {
    find(`${B}(übermorgen|uebermorgen|day after tomorrow)${E}`, 'date', () => {
      date = addDays(today, 2);
    });
  }
  if (!date) {
    find(`${B}(morgen|tomorrow)${E}`, 'date', (match) => {
      const after = lower.slice(match.index + match[0].length, match.index + match[0].length + 4);
      if (/^\s*früh/.test(after)) start ??= 9 * 60;
      date = addDays(today, 1);
    });
  }
  if (!date) {
    find(`${B}(heute|today|tonight|heute abend)${E}`, 'date', (match) => {
      date = today;
      if (/tonight|abend/.test(match[0])) start ??= 19 * 60;
    });
  }
  if (!date) {
    find(`${B}in\\s+${NUMBER}\\s+(tagen|tag|days?|wochen|woche|weeks?|monaten|monat|months?|jahren|jahr|years?)${E}`, 'date', (match) => {
      const amount = numberOf(match[1]);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) return false;
      const unit = match[2];
      if (/^(tag|day)/.test(unit)) date = addDays(today, amount);
      else if (/^(woche|week)/.test(unit)) date = addDays(today, amount * 7);
      else if (/^(monat|month)/.test(unit)) date = addMonths(today, amount);
      else date = addMonths(today, amount * 12);
    });
  }
  if (!date) {
    find(`${B}(nächste woche|naechste woche|kommende woche|next week)${E}`, 'date', () => {
      date = addDays(startOfWeek(today, weekStart), 7);
    });
  }
  if (!date) {
    find(`${B}(?:(am|on|nächsten|nächste|naechsten|kommenden|next|this|diesen|coming)\\s+)?(${WEEKDAY_WORDS})${E}`, 'date', (match) => {
      const weekday = weekdayOfWord(match[2]);
      if (weekday === null) return false;
      if (/^(mon|sun|sat|wed|fri|thu|tue)$/.test(match[2]) && !match[1]) return false;
      const next = Boolean(match[1] && /^(nächsten|nächste|naechsten|next|kommenden|coming)$/.test(match[1]));
      date = upcoming(today, weekday, next);
    });
  }

  const clock = (hours: string, minutes: string | undefined, meridiem?: string) => {
    let hour = Number(hours);
    const minute = minutes ? Number(minutes) : 0;
    hour = hour12(hour, meridiem);
    if (hour > 24 || minute > 59) return null;
    return hour * 60 + minute;
  };

  find(
    `${B}(?:von\\s+|from\\s+|between\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm|a\\.m\\.|p\\.m\\.)?\\s*(?:-|–|—|bis|to|until|till|and)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(uhr|h|am|pm|a\\.m\\.|p\\.m\\.)?${E}`,
    'time',
    (match) => {
      const meridiemEnd = match[6] && /[ap]/.test(match[6]) ? match[6] : undefined;
      const hasMarker = Boolean(match[2] || match[3] || match[5] || match[6] || /^(von|from|between)/.test(match[0]));
      if (!hasMarker && !(Number(match[4]) <= 24 && Number(match[4]) > Number(match[1]))) return false;
      let from = clock(match[1], match[2], match[3] ?? (meridiemEnd && Number(match[1]) <= Number(match[4]) ? meridiemEnd : undefined));
      const to = clock(match[4], match[5], meridiemEnd);
      if (from === null || to === null) return false;
      if (to <= from && !match[3] && meridiemEnd && from + 12 * 60 < to + 24 * 60) from = from % (12 * 60);
      start = from;
      end = to > from ? to : to + 24 * 60 <= from + 24 * 60 ? null : to;
    }
  );
  if (start === null) {
    find(
      `${B}(?:um\\s+|at\\s+|ab\\s+|gegen\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(uhr|h|am|pm|a\\.m\\.|p\\.m\\.)${E}|${B}(?:um|at|ab|gegen)\\s+(\\d{1,2})(?:[:.](\\d{2}))?${E}|${B}(\\d{1,2}):(\\d{2})${E}`,
      'time',
      (match) => {
        const value =
          match[1] !== undefined
            ? clock(match[1], match[2], match[3] && /[ap]/.test(match[3]) ? match[3] : undefined)
            : match[4] !== undefined
              ? clock(match[4], match[5])
              : clock(match[6], match[7]);
        if (value === null) return false;
        start = value;
      }
    );
  }
  if (start === null) {
    find(`${B}(mittags|mittag|noon|midday)${E}`, 'time', () => {
      start = 12 * 60;
    });
  }
  if (start === null) {
    find(`${B}(abends|in the evening)${E}`, 'time', () => {
      start = 19 * 60;
    });
  }
  if (start === null) {
    find(`${B}(nachmittags|in the afternoon)${E}`, 'time', () => {
      start = 15 * 60;
    });
  }
  if (start === null) {
    find(`${B}(morgens|vormittags|in the morning)${E}`, 'time', () => {
      start = 9 * 60;
    });
  }

  find(
    `${B}(?:für\\s+|for\\s+)?(\\d+(?:[.,]\\d+)?|eine|einen|ein|an|a|one|zwei|two|drei|three)\\s*(stunden|stunde|std\\.?|hours?|hrs?|h|minuten|min\\.?|minutes?|mins?)${E}`,
    'duration',
    (match) => {
      const raw = match[1].replace(',', '.');
      const amount = NUMBER_WORDS[raw] ?? Number(raw);
      if (!Number.isFinite(amount) || amount <= 0) return false;
      const minutes = /^(st|ho|hr|h)/.test(match[2]) ? amount * 60 : amount;
      if (minutes > 14 * 24 * 60) return false;
      duration = Math.round(minutes);
    }
  );
  if (duration === null) {
    find(`${B}(?:für\\s+|for\\s+)(eine halbe stunde|half an hour|eine viertelstunde|a quarter of an hour)${E}`, 'duration', (match) => {
      duration = /halb|half/.test(match[1]) ? 30 : 15;
    });
  }

  find(`(?:^|\\s)@\\s*([^#@]+?)\\s*(?=#|$)`, 'place', (match) => {
    location = text
      .slice(match.index, match.index + match[0].length)
      .replace(/^\s*@\s*/, '')
      .trim();
    return Boolean(location);
  });
  if (!location) {
    const regex = /\s(?:in|im|at|bei)\s+([A-ZÄÖÜ][\p{L}\p{N}.'’-]*(?:\s+[A-ZÄÖÜ0-9][\p{L}\p{N}.'’-]*){0,3})\s*$/u;
    const head = text.slice(0, Math.min(...used.filter(([, b]) => b === text.length).map(([a]) => a), text.length));
    const match = regex.exec(head);
    if (match && free(match.index, match.index + match[0].length)) {
      const word = match[0].trim().split(/\s+/)[0].toLowerCase();
      if (word !== 'bei' || match[1].split(/\s+/).length > 0) {
        location = match[1].trim();
        take(match.index, match.index + match[0].length, 'place');
      }
    }
  }

  if (start !== null && end === null && duration !== null) end = start + duration;
  if (end !== null && start !== null && end <= start) end = null;
  if (!date && (start !== null || rrule)) {
    date = today;
    if (start !== null && options.nowMinutes !== undefined && start < options.nowMinutes && !rrule) date = addDays(today, 1);
  }

  const sorted = [...used].sort((a, b) => a[0] - b[0]);
  let title = '';
  let cursor = 0;
  for (const [from, to] of sorted) {
    if (from > cursor) title += text.slice(cursor, from);
    title += ' ';
    cursor = Math.max(cursor, to);
  }
  title += text.slice(cursor);
  title = title
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(^|\s)(am|um|von|bis|ab|an|on|at|from|to|für|for|in|im|bei|und|and|,|-|–)(?=\s*$)/giu, '')
    .replace(/^(\s*(am|um|von|on|at|from|für|for|,|-|–)\s+)+/giu, '')
    .replace(/\s+(am|um|von|on|at|from|für|for|in|im|bei)$/giu, '')
    .replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, '')
    .trim();

  return {
    title,
    date,
    start,
    end,
    duration,
    allDay: start === null,
    rrule,
    location,
    tags,
    spans: spans.sort((a, b) => a.from - b.from),
  };
}
