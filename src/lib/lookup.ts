export function lookup<T>(entries: Record<string, T>): Record<string, T> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, T>, entries));
}
