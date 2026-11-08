import type { FastifyBaseLogger } from 'fastify';

let logger: FastifyBaseLogger | null = null;

export const setLogger = (value: FastifyBaseLogger | null) => {
  logger = value;
};

export const log = {
  info: (data: unknown, message?: string) => logger?.info(data, message),
  warn: (data: unknown, message?: string) => logger?.warn(data, message),
  error: (data: unknown, message?: string) => logger?.error(data, message),
  debug: (data: unknown, message?: string) => logger?.debug(data, message),
};
