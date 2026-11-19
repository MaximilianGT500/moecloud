import { format } from 'node:util';
import type { FastifyBaseLogger } from 'fastify';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  message: string;
  detail: string | null;
}

const LIMIT = 400;
const RANK: Record<LogLevel, number> = { info: 30, warn: 40, error: 50 };
const entries: LogEntry[] = [];
let counter = 0;
let logger: FastifyBaseLogger | null = null;

export const setLogger = (value: FastifyBaseLogger | null) => {
  logger = value;
};

function fieldsOf(data: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (parts.length >= 12) break;
    if (key === 'err' || key === 'error' || key === 'req' || key === 'res') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      parts.push(`${key}: ${String(value).slice(0, 200)}`);
  }
  return parts;
}

export function remember(level: number, args: unknown[]) {
  if (level < RANK.info) return;
  const [first, ...rest] = args;
  let message = '';
  const detail: string[] = [];
  if (typeof first === 'string') message = format(first, ...rest);
  else {
    if (typeof rest[0] === 'string') message = format(rest[0], ...rest.slice(1));
    if (first instanceof Error) {
      if (!message) message = first.message;
      detail.push(first.stack ?? first.message);
    } else if (first && typeof first === 'object') {
      const data = first as Record<string, unknown>;
      const problem = data.err ?? data.error;
      if (problem instanceof Error) {
        if (!message) message = problem.message;
        detail.push(problem.stack ?? problem.message);
      } else if (typeof problem === 'string') {
        if (!message) message = problem;
        else detail.push(problem);
      }
      detail.push(...fieldsOf(data));
    } else if (first !== undefined && !message) message = String(first);
  }
  entries.push({
    id: ++counter,
    at: Date.now(),
    level: level >= RANK.error ? 'error' : level >= RANK.warn ? 'warn' : 'info',
    message: message.slice(0, 600),
    detail: detail.length ? detail.join('\n').slice(0, 4000) : null,
  });
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
}

export function recentLog(level: LogLevel = 'info') {
  return entries.filter((entry) => RANK[entry.level] >= RANK[level]).reverse();
}

export function clearLog() {
  entries.length = 0;
}

export const log = {
  info: (data: unknown, message?: string) => logger?.info(data, message),
  warn: (data: unknown, message?: string) => logger?.warn(data, message),
  error: (data: unknown, message?: string) => logger?.error(data, message),
  debug: (data: unknown, message?: string) => logger?.debug(data, message),
};
