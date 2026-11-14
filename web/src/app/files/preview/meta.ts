import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import type { Item } from '../kinds';

export interface NodeMeta {
  width: number | null;
  height: number | null;
  takenAt: number | null;
  processed: boolean;
  meta: Record<string, string | number | boolean | undefined>;
  scan: { status: string; signature: string | null; at: number | null } | null;
}

export function useMeta(item: Item | null, base = '/api') {
  const [state, setState] = useState<{ key: string; meta: NodeMeta | null } | null>(null);
  const key = item ? `${base}:${item.id}:${item.version}` : '';
  useEffect(() => {
    if (!item || item.type !== 'file' || item.trashedAt) return;
    const abort = new AbortController();
    api
      .get<NodeMeta>(`${base}/nodes/${item.id}/meta`, abort.signal)
      .then((meta) => setState({ key, meta }))
      .catch(() => setState({ key, meta: null }));
    return () => abort.abort();
  }, [item, base, key]);
  return state?.key === key ? state.meta : null;
}
