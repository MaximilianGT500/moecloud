import { availableParallelism } from 'node:os';

function count() {
  const configured = Number(process.env.PROCESSING_WORKERS);
  if (Number.isInteger(configured) && configured > 0) return Math.min(configured, 16);
  return Math.max(1, Math.min(4, availableParallelism() - 1));
}

export const WORKERS = count();
