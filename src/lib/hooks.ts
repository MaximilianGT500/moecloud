export type HookListener = (name: string, payload: Record<string, unknown>) => void;
export type HookFilter = (name: string, payload: Record<string, unknown>) => Promise<void>;

let listener: HookListener | null = null;
let filter: HookFilter | null = null;

export function setHooks(next: { listener: HookListener | null; filter: HookFilter | null }) {
  listener = next.listener;
  filter = next.filter;
}

export function emitHook(name: string, payload: () => Record<string, unknown>) {
  if (!listener) return;
  const target = listener;
  setImmediate(() => {
    try {
      target(name, payload());
    } catch {
      return;
    }
  });
}

export async function runFilter(name: string, payload: () => Record<string, unknown>) {
  if (filter) await filter(name, payload());
}
