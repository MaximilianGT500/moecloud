import { addDays, dateKey, dayNumber, daysInMonth, keyOfDay, weekdayOf, weekdayOfDay } from './time.ts';

export interface Holiday {
  date: string;
  name: { de: string; en: string };
  region: string;
  kind: 'holiday' | 'observance';
}

export interface Region {
  id: string;
  country: string;
  name: { de: string; en: string };
}

export const REGIONS: Region[] = [
  { id: 'de', country: 'de', name: { de: 'Deutschland (bundesweit)', en: 'Germany (nationwide)' } },
  { id: 'de-bw', country: 'de', name: { de: 'Baden-Württemberg', en: 'Baden-Württemberg' } },
  { id: 'de-by', country: 'de', name: { de: 'Bayern', en: 'Bavaria' } },
  { id: 'de-be', country: 'de', name: { de: 'Berlin', en: 'Berlin' } },
  { id: 'de-bb', country: 'de', name: { de: 'Brandenburg', en: 'Brandenburg' } },
  { id: 'de-hb', country: 'de', name: { de: 'Bremen', en: 'Bremen' } },
  { id: 'de-hh', country: 'de', name: { de: 'Hamburg', en: 'Hamburg' } },
  { id: 'de-he', country: 'de', name: { de: 'Hessen', en: 'Hesse' } },
  { id: 'de-mv', country: 'de', name: { de: 'Mecklenburg-Vorpommern', en: 'Mecklenburg-Western Pomerania' } },
  { id: 'de-ni', country: 'de', name: { de: 'Niedersachsen', en: 'Lower Saxony' } },
  { id: 'de-nw', country: 'de', name: { de: 'Nordrhein-Westfalen', en: 'North Rhine-Westphalia' } },
  { id: 'de-rp', country: 'de', name: { de: 'Rheinland-Pfalz', en: 'Rhineland-Palatinate' } },
  { id: 'de-sl', country: 'de', name: { de: 'Saarland', en: 'Saarland' } },
  { id: 'de-sn', country: 'de', name: { de: 'Sachsen', en: 'Saxony' } },
  { id: 'de-st', country: 'de', name: { de: 'Sachsen-Anhalt', en: 'Saxony-Anhalt' } },
  { id: 'de-sh', country: 'de', name: { de: 'Schleswig-Holstein', en: 'Schleswig-Holstein' } },
  { id: 'de-th', country: 'de', name: { de: 'Thüringen', en: 'Thuringia' } },
  { id: 'at', country: 'at', name: { de: 'Österreich', en: 'Austria' } },
  { id: 'ch', country: 'ch', name: { de: 'Schweiz', en: 'Switzerland' } },
  { id: 'gb', country: 'gb', name: { de: 'Vereinigtes Königreich (England, Wales)', en: 'United Kingdom (England, Wales)' } },
  { id: 'us', country: 'us', name: { de: 'Vereinigte Staaten', en: 'United States' } },
];

export const isRegion = (value: unknown): value is string => typeof value === 'string' && REGIONS.some((region) => region.id === value);

export function easter(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateKey(year, month, day);
}

function nthWeekday(year: number, month: number, weekday: number, nth: number) {
  if (nth > 0) {
    const first = dayNumber(year, month, 1);
    return keyOfDay(first + ((weekday - weekdayOfDay(first) + 7) % 7) + (nth - 1) * 7);
  }
  const last = dayNumber(year, month, daysInMonth(year, month));
  return keyOfDay(last - ((weekdayOfDay(last) - weekday + 7) % 7) + (nth + 1) * 7);
}

type Rule = { de: string; en: string; date: (year: number) => string | null; regions: string[]; from?: number; to?: number };

const fixed = (month: number, day: number) => (year: number) => dateKey(year, month, day);
const fromEaster = (offset: number) => (year: number) => addDays(easter(year), offset);

function firstAdvent(year: number) {
  const christmas = dayNumber(year, 12, 25);
  const sundayBefore = christmas - ((weekdayOfDay(christmas) + 7) % 7 || 7);
  return keyOfDay(sundayBefore - 21);
}

function repentance(year: number) {
  const nov23 = dayNumber(year, 11, 23);
  const offset = (weekdayOfDay(nov23) - 3 + 7) % 7 || 7;
  return keyOfDay(nov23 - offset);
}

const DE_ALL = ['de'];

const HOLIDAYS: Rule[] = [
  { de: 'Neujahr', en: "New Year's Day", date: fixed(1, 1), regions: ['de', 'at', 'ch'] },
  { de: 'Berchtoldstag', en: "Saint Berchtold's Day", date: fixed(1, 2), regions: ['ch'] },
  { de: 'Heilige Drei Könige', en: 'Epiphany', date: fixed(1, 6), regions: ['de-bw', 'de-by', 'de-st', 'at'] },
  { de: 'Internationaler Frauentag', en: "International Women's Day", date: fixed(3, 8), regions: ['de-be'], from: 2019 },
  { de: 'Internationaler Frauentag', en: "International Women's Day", date: fixed(3, 8), regions: ['de-mv'], from: 2023 },
  { de: 'Karfreitag', en: 'Good Friday', date: fromEaster(-2), regions: [...DE_ALL, 'ch', 'gb'] },
  { de: 'Ostersonntag', en: 'Easter Sunday', date: fromEaster(0), regions: ['de-bb'] },
  { de: 'Ostermontag', en: 'Easter Monday', date: fromEaster(1), regions: [...DE_ALL, 'at', 'ch', 'gb'] },
  { de: 'Tag der Arbeit', en: 'Labour Day', date: fixed(5, 1), regions: DE_ALL },
  { de: 'Staatsfeiertag', en: 'National Holiday', date: fixed(5, 1), regions: ['at'] },
  { de: 'Christi Himmelfahrt', en: 'Ascension Day', date: fromEaster(39), regions: [...DE_ALL, 'at'] },
  { de: 'Auffahrt', en: 'Ascension Day', date: fromEaster(39), regions: ['ch'] },
  { de: 'Pfingstsonntag', en: 'Whit Sunday', date: fromEaster(49), regions: ['de-bb'] },
  { de: 'Pfingstmontag', en: 'Whit Monday', date: fromEaster(50), regions: [...DE_ALL, 'at', 'ch'] },
  { de: 'Fronleichnam', en: 'Corpus Christi', date: fromEaster(60), regions: ['de-bw', 'de-by', 'de-he', 'de-nw', 'de-rp', 'de-sl', 'at'] },
  { de: 'Bundesfeier', en: 'Swiss National Day', date: fixed(8, 1), regions: ['ch'] },
  { de: 'Mariä Himmelfahrt', en: 'Assumption Day', date: fixed(8, 15), regions: ['de-sl', 'de-by', 'at'] },
  { de: 'Weltkindertag', en: "World Children's Day", date: fixed(9, 20), regions: ['de-th'], from: 2019 },
  { de: 'Tag der Deutschen Einheit', en: 'German Unity Day', date: fixed(10, 3), regions: DE_ALL },
  { de: 'Nationalfeiertag', en: 'National Day', date: fixed(10, 26), regions: ['at'] },
  { de: 'Reformationstag', en: 'Reformation Day', date: fixed(10, 31), regions: ['de-bb', 'de-mv', 'de-sn', 'de-st', 'de-th'] },
  { de: 'Reformationstag', en: 'Reformation Day', date: fixed(10, 31), regions: ['de-hb', 'de-hh', 'de-ni', 'de-sh'], from: 2018 },
  { de: 'Allerheiligen', en: "All Saints' Day", date: fixed(11, 1), regions: ['de-bw', 'de-by', 'de-nw', 'de-rp', 'de-sl', 'at'] },
  { de: 'Buß- und Bettag', en: 'Day of Repentance and Prayer', date: repentance, regions: ['de-sn'] },
  { de: 'Mariä Empfängnis', en: 'Immaculate Conception', date: fixed(12, 8), regions: ['at'] },
  { de: '1. Weihnachtstag', en: 'Christmas Day', date: fixed(12, 25), regions: DE_ALL },
  { de: '2. Weihnachtstag', en: "St. Stephen's Day", date: fixed(12, 26), regions: DE_ALL },
  { de: 'Christtag', en: 'Christmas Day', date: fixed(12, 25), regions: ['at'] },
  { de: 'Stefanitag', en: "St. Stephen's Day", date: fixed(12, 26), regions: ['at'] },
  { de: 'Weihnachten', en: 'Christmas Day', date: fixed(12, 25), regions: ['ch'] },
  { de: 'Stephanstag', en: "St. Stephen's Day", date: fixed(12, 26), regions: ['ch'] },
  { de: 'Early May Bank Holiday', en: 'Early May Bank Holiday', date: (year) => nthWeekday(year, 5, 1, 1), regions: ['gb'] },
  { de: 'Spring Bank Holiday', en: 'Spring Bank Holiday', date: (year) => nthWeekday(year, 5, 1, -1), regions: ['gb'] },
  { de: 'Summer Bank Holiday', en: 'Summer Bank Holiday', date: (year) => nthWeekday(year, 8, 1, -1), regions: ['gb'] },
  { de: 'Martin Luther King Jr. Day', en: 'Martin Luther King Jr. Day', date: (year) => nthWeekday(year, 1, 1, 3), regions: ['us'] },
  { de: "Presidents' Day", en: "Presidents' Day", date: (year) => nthWeekday(year, 2, 1, 3), regions: ['us'] },
  { de: 'Memorial Day', en: 'Memorial Day', date: (year) => nthWeekday(year, 5, 1, -1), regions: ['us'] },
  { de: 'Labor Day', en: 'Labor Day', date: (year) => nthWeekday(year, 9, 1, 1), regions: ['us'] },
  { de: 'Columbus Day', en: 'Columbus Day', date: (year) => nthWeekday(year, 10, 1, 2), regions: ['us'] },
  { de: 'Thanksgiving', en: 'Thanksgiving Day', date: (year) => nthWeekday(year, 11, 4, 4), regions: ['us'] },
];

function observed(key: string, kind: 'us' | 'gb') {
  const weekday = weekdayOf(key);
  if (kind === 'us') return weekday === 6 ? addDays(key, -1) : weekday === 0 ? addDays(key, 1) : key;
  return weekday === 6 ? addDays(key, 2) : weekday === 0 ? addDays(key, 1) : key;
}

function observedHolidays(year: number, region: string): Holiday[] {
  const out: Holiday[] = [];
  const add = (date: string, de: string, en: string) => out.push({ date, name: { de, en }, region, kind: 'holiday' });
  if (region === 'us') {
    add(observed(dateKey(year, 1, 1), 'us'), 'Neujahr', "New Year's Day");
    if (year >= 2021) add(observed(dateKey(year, 6, 19), 'us'), 'Juneteenth', 'Juneteenth');
    add(observed(dateKey(year, 7, 4), 'us'), 'Unabhängigkeitstag', 'Independence Day');
    add(observed(dateKey(year, 11, 11), 'us'), 'Veterans Day', 'Veterans Day');
    add(observed(dateKey(year, 12, 25), 'us'), 'Weihnachten', 'Christmas Day');
  }
  if (region === 'gb') {
    add(observed(dateKey(year, 1, 1), 'gb'), 'Neujahr', "New Year's Day");
    const christmas = dateKey(year, 12, 25);
    const christmasDay = observed(christmas, 'gb');
    add(christmasDay, 'Weihnachten', 'Christmas Day');
    let boxing = dateKey(year, 12, 26);
    if (weekdayOf(boxing) === 6 || weekdayOf(boxing) === 0 || boxing === christmasDay) boxing = addDays(christmasDay, 1);
    if (weekdayOf(boxing) === 6) boxing = addDays(boxing, 2);
    if (weekdayOf(boxing) === 0) boxing = addDays(boxing, 1);
    add(boxing, 'Boxing Day', 'Boxing Day');
  }
  return out;
}

const OBSERVANCES: { de: string; en: string; date: (year: number) => string | null; countries: string[] }[] = [
  { de: 'Valentinstag', en: "Valentine's Day", date: fixed(2, 14), countries: ['de', 'at', 'ch', 'gb', 'us'] },
  { de: 'Weiberfastnacht', en: "Women's Carnival Day", date: fromEaster(-52), countries: ['de'] },
  { de: 'Rosenmontag', en: 'Rose Monday', date: fromEaster(-48), countries: ['de'] },
  { de: 'Faschingsdienstag', en: 'Shrove Tuesday', date: fromEaster(-47), countries: ['de', 'at', 'gb', 'us'] },
  { de: 'Aschermittwoch', en: 'Ash Wednesday', date: fromEaster(-46), countries: ['de', 'at', 'ch'] },
  { de: 'Palmsonntag', en: 'Palm Sunday', date: fromEaster(-7), countries: ['de', 'at', 'ch'] },
  { de: 'Gründonnerstag', en: 'Maundy Thursday', date: fromEaster(-3), countries: ['de', 'at', 'ch'] },
  { de: 'Ostersonntag', en: 'Easter Sunday', date: fromEaster(0), countries: ['de', 'at', 'ch', 'gb', 'us'] },
  { de: 'Pfingstsonntag', en: 'Whit Sunday', date: fromEaster(49), countries: ['de', 'at', 'ch'] },
  { de: 'Muttertag', en: "Mother's Day", date: (year) => nthWeekday(year, 5, 0, 2), countries: ['de', 'at', 'ch', 'us'] },
  { de: 'Mothering Sunday', en: 'Mothering Sunday', date: fromEaster(-21), countries: ['gb'] },
  { de: 'Vatertag', en: "Father's Day", date: (year) => nthWeekday(year, 6, 0, 3), countries: ['gb', 'us'] },
  { de: 'Vatertag', en: "Father's Day", date: fromEaster(39), countries: ['de'] },
  {
    de: 'Beginn der Sommerzeit',
    en: 'Daylight saving time starts',
    date: (year) => nthWeekday(year, 3, 0, -1),
    countries: ['de', 'at', 'ch', 'gb'],
  },
  {
    de: 'Ende der Sommerzeit',
    en: 'Daylight saving time ends',
    date: (year) => nthWeekday(year, 10, 0, -1),
    countries: ['de', 'at', 'ch', 'gb'],
  },
  { de: 'Beginn der Sommerzeit', en: 'Daylight saving time starts', date: (year) => nthWeekday(year, 3, 0, 2), countries: ['us'] },
  { de: 'Ende der Sommerzeit', en: 'Daylight saving time ends', date: (year) => nthWeekday(year, 11, 0, 1), countries: ['us'] },
  { de: 'Halloween', en: 'Halloween', date: fixed(10, 31), countries: ['de', 'at', 'ch', 'gb', 'us'] },
  { de: 'Martinstag', en: "St. Martin's Day", date: fixed(11, 11), countries: ['de', 'at', 'ch'] },
  { de: 'Volkstrauertag', en: 'National Day of Mourning', date: (year) => addDays(firstAdvent(year), -14), countries: ['de'] },
  { de: 'Totensonntag', en: 'Sunday of the Dead', date: (year) => addDays(firstAdvent(year), -7), countries: ['de'] },
  { de: '1. Advent', en: 'First Sunday of Advent', date: firstAdvent, countries: ['de', 'at', 'ch'] },
  { de: '2. Advent', en: 'Second Sunday of Advent', date: (year) => addDays(firstAdvent(year), 7), countries: ['de', 'at', 'ch'] },
  { de: '3. Advent', en: 'Third Sunday of Advent', date: (year) => addDays(firstAdvent(year), 14), countries: ['de', 'at', 'ch'] },
  { de: '4. Advent', en: 'Fourth Sunday of Advent', date: (year) => addDays(firstAdvent(year), 21), countries: ['de', 'at', 'ch'] },
  { de: 'Nikolaus', en: "St. Nicholas' Day", date: fixed(12, 6), countries: ['de', 'at', 'ch'] },
  { de: 'Heiligabend', en: 'Christmas Eve', date: fixed(12, 24), countries: ['de', 'at', 'ch', 'gb', 'us'] },
  { de: 'Silvester', en: "New Year's Eve", date: fixed(12, 31), countries: ['de', 'at', 'ch', 'gb', 'us'] },
];

function regionMatches(rule: string[], region: string) {
  if (rule.includes(region)) return true;
  return region.startsWith('de-') && rule.includes('de');
}

export function holidaysIn(year: number, regions: string[], observances = false): Holiday[] {
  const out = new Map<string, Holiday>();
  for (const region of regions) {
    if (!isRegion(region)) continue;
    for (const rule of HOLIDAYS) {
      if (rule.from && year < rule.from) continue;
      if (rule.to && year > rule.to) continue;
      if (!regionMatches(rule.regions, region)) continue;
      const date = rule.date(year);
      if (!date) continue;
      const key = `${date}|${rule.de}`;
      if (!out.has(key)) out.set(key, { date, name: { de: rule.de, en: rule.en }, region, kind: 'holiday' });
    }
    for (const holiday of observedHolidays(year, region)) out.set(`${holiday.date}|${holiday.name.de}`, holiday);
  }
  if (observances) {
    const countries = new Set(regions.filter(isRegion).map((region) => region.split('-')[0]));
    for (const rule of OBSERVANCES) {
      if (!rule.countries.some((country) => countries.has(country))) continue;
      const date = rule.date(year);
      if (!date) continue;
      if ([...out.values()].some((holiday) => holiday.date === date && holiday.name.de === rule.de)) continue;
      const key = `${date}|${rule.de}`;
      if (!out.has(key)) out.set(key, { date, name: { de: rule.de, en: rule.en }, region: 'observance', kind: 'observance' });
    }
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.de.localeCompare(b.name.de));
}

export function holidaysBetween(from: string, to: string, regions: string[], observances = false): Holiday[] {
  const first = Number(from.slice(0, 4));
  const last = Number(to.slice(0, 4));
  const out: Holiday[] = [];
  for (let year = first; year <= last; year++) {
    for (const holiday of holidaysIn(year, regions, observances)) if (holiday.date >= from && holiday.date < to) out.push(holiday);
  }
  return out;
}

export const holidayId = (holiday: Holiday) =>
  `holiday-${holiday.region}-${holiday.date}-${holiday.name.en.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
