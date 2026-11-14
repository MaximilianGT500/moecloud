import { PG_IDENTITY as IDENTITY } from './schema-pg.ts';

export interface Translated {
  text: string;
  identity: string | null;
}

const cache = new Map<string, Translated>();

function segments(sql: string) {
  const parts: { code: boolean; text: string }[] = [];
  let start = 0;
  let index = 0;
  const push = (code: boolean, end: number) => {
    if (end > start) parts.push({ code, text: sql.slice(start, end) });
    start = end;
  };
  while (index < sql.length) {
    const char = sql[index];
    if (char === "'" || char === '"') {
      push(true, index);
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === char) {
          if (sql[end + 1] === char) end += 2;
          else break;
        } else end++;
      }
      index = end + 1;
      push(false, Math.min(index, sql.length));
    } else if (char === '-' && sql[index + 1] === '-') {
      push(true, index);
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      push(false, index);
    } else index++;
  }
  push(true, sql.length);
  return parts;
}

function rewrite(code: string) {
  return code
    .replace(/([\w.]+)\s+COLLATE\s+NOCASE/gi, 'lower($1)')
    .replace(/\bCOLLATE\s+BINARY\b/gi, 'COLLATE "C"')
    .replace(/\bLIKE\b/gi, 'ILIKE')
    .replace(/\bIS\s+NOT\s+\?/gi, 'IS DISTINCT FROM ?')
    .replace(/\bIS\s+\?/gi, 'IS NOT DISTINCT FROM ?')
    .replace(/\bjson_each\(\s*\?\s*\)/gi, 'jsonb_array_elements_text(?::jsonb)');
}

export function toPostgres(sql: string): Translated {
  const known = cache.get(sql);
  if (known) return known;
  let text = sql.trim().replace(/;$/, '');
  const ignore = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text);
  if (ignore) text = text.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  let count = 0;
  text = segments(text)
    .map((part) => (part.code ? rewrite(part.text).replace(/\?/g, () => `$${++count}`) : part.text))
    .join('');
  if (ignore) text += ' ON CONFLICT DO NOTHING';
  const table = /^INSERT\s+INTO\s+(\w+)/i.exec(text)?.[1]?.toLowerCase();
  const identity = table && !/\bRETURNING\b/i.test(text) ? (IDENTITY[table] ?? null) : null;
  if (identity) text += ` RETURNING ${identity}`;
  const translated = { text, identity };
  if (cache.size > 2000) cache.clear();
  cache.set(sql, translated);
  return translated;
}
