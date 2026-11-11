import { useEffect, useState } from 'react';
import { api, csrfToken } from '../../lib/api';
import { t, language } from '../../lib/i18n';
import type { Item } from './kinds';

export interface Subtitle {
  id: string;
  name: string;
  lang: string | null;
  code: string | undefined;
  label: string;
}

const names = (() => {
  try {
    return new Intl.DisplayNames([language], { type: 'language' });
  } catch {
    return null;
  }
})();

function labelOf(lang: string | null) {
  if (!lang) return t('Untertitel');
  const [code, ...rest] = lang.split('.');
  let label = code;
  try {
    label = names?.of(code) ?? code;
  } catch {
    label = code;
  }
  return rest.length ? `${label} (${rest.join(', ')})` : label;
}

const validCode = (lang: string | null) => {
  const code = lang?.split('.')[0];
  if (!code) return undefined;
  try {
    return Intl.getCanonicalLocales(code)[0];
  } catch {
    return undefined;
  }
};

export function useSubtitles(item: Item, base: string) {
  const [state, setState] = useState<{ key: string; list: Subtitle[] } | null>(null);
  const key = `${base}:${item.id}`;
  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ items: { id: string; name: string; lang: string | null }[] }>(`${base}/nodes/${item.id}/subtitles`, abort.signal)
      .then((result) =>
        setState({
          key,
          list: result.items.map((entry) => ({ ...entry, code: validCode(entry.lang), label: labelOf(entry.lang) })),
        })
      )
      .catch(() => setState({ key, list: [] }));
    return () => abort.abort();
  }, [item.id, base, key]);
  const list = state?.key === key ? state.list : [];
  const wanted = list.findIndex((entry) => entry.code?.toLowerCase().startsWith(language));
  return { list, preferred: wanted >= 0 ? wanted : 0 };
}

export interface Position {
  seconds: number;
  duration: number;
}

export async function loadPosition(item: Pick<Item, 'id'>, signal?: AbortSignal) {
  const result = await api.get<{ position: Position | null }>(`/api/nodes/${item.id}/position`, signal);
  return result.position;
}

export function storePosition(item: Pick<Item, 'id'>, seconds: number, duration: number, keepalive = false) {
  if (!Number.isFinite(seconds) || !Number.isFinite(duration)) return;
  void fetch(`/api/nodes/${item.id}/position`, {
    method: 'PUT',
    credentials: 'same-origin',
    keepalive,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
    body: JSON.stringify({ seconds: Math.max(0, seconds), duration: Math.max(0, duration) }),
  })
    .then(() => {
      if (keepalive) window.dispatchEvent(new Event('moe:position'));
    })
    .catch(() => undefined);
}

export function useResume(item: Item, media: HTMLMediaElement | null, enabled: boolean, minimum: number) {
  const [resumed, setResumed] = useState<{ key: string; seconds: number } | null>(null);
  const key = item.id + item.version;
  const id = item.id;

  useEffect(() => {
    if (!enabled || !media) return;
    const abort = new AbortController();
    let last = 0;
    let pending = true;
    const save = (keepalive = false) => {
      if (pending || media.played.length === 0 || !Number.isFinite(media.duration) || media.duration < minimum) return;
      last = Date.now();
      storePosition({ id }, media.ended ? media.duration : media.currentTime, media.duration, keepalive);
    };
    const onTime = () => {
      if (Date.now() - last > 10_000) save();
    };
    const onPause = () => save();
    const apply = (position: Position | null) => {
      if (!position || abort.signal.aborted) {
        pending = false;
        return;
      }
      const jump = () => {
        pending = false;
        if (!Number.isFinite(media.duration) || media.duration < minimum || position.seconds > media.duration - 15) return;
        media.currentTime = position.seconds;
        setResumed({ key, seconds: position.seconds });
      };
      if (media.readyState >= 1) jump();
      else media.addEventListener('loadedmetadata', jump, { once: true, signal: abort.signal });
    };
    loadPosition({ id }, abort.signal)
      .then(apply)
      .catch(() => {
        pending = false;
      });
    media.addEventListener('timeupdate', onTime, { signal: abort.signal });
    media.addEventListener('pause', onPause, { signal: abort.signal });
    media.addEventListener('ended', onPause, { signal: abort.signal });
    const leave = () => save(true);
    window.addEventListener('pagehide', leave, { signal: abort.signal });
    return () => {
      abort.abort();
      save(true);
    };
  }, [id, media, enabled, minimum, key]);

  useEffect(() => {
    if (!resumed) return;
    const timer = setTimeout(() => setResumed(null), 8000);
    return () => clearTimeout(timer);
  }, [resumed]);

  return {
    resumedAt: resumed?.key === key ? resumed.seconds : null,
    restart: () => {
      if (media) media.currentTime = 0;
      setResumed(null);
    },
  };
}
