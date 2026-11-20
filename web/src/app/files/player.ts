import { useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { toast } from '../common/toast';
import { contentUrl, thumbUrl, type Item } from './kinds';
import { loadPosition, storePosition } from './playback';

export type Repeat = 'off' | 'all' | 'one';
export type Sleep = { until: number } | { track: true } | null;
export const RATES = [0.75, 1, 1.25, 1.5, 2] as const;

export interface TrackInfo {
  title: string;
  artist: string;
  album: string;
}

export interface PlayerState {
  queue: Item[];
  original: Item[] | null;
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  repeat: Repeat;
  shuffle: boolean;
  volume: number;
  rate: number;
  sleep: Sleep;
  info: Record<string, TrackInfo>;
}

const STORAGE = 'moe-player';
const LONG = 600;
const MAX_QUEUE = 1000;

const slim = (item: Item): Item => ({
  id: item.id,
  parentId: item.parentId,
  type: 'file',
  name: item.name,
  kind: item.kind,
  mime: item.mime,
  size: item.size,
  items: null,
  modifiedAt: item.modifiedAt,
  version: item.version,
  thumb: item.thumb,
});

function restore(): PlayerState {
  const empty: PlayerState = {
    queue: [],
    original: null,
    index: 0,
    playing: false,
    time: 0,
    duration: 0,
    repeat: 'off',
    shuffle: false,
    volume: 1,
    rate: 1,
    sleep: null,
    info: {},
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as Partial<PlayerState> | null;
    if (!saved || !Array.isArray(saved.queue)) return empty;
    const queue = saved.queue.slice(0, MAX_QUEUE);
    return {
      ...empty,
      queue,
      original: Array.isArray(saved.original) ? saved.original.slice(0, MAX_QUEUE) : null,
      index: Math.min(Math.max(0, Number(saved.index) || 0), Math.max(0, queue.length - 1)),
      time: Math.max(0, Number(saved.time) || 0),
      repeat: saved.repeat === 'all' || saved.repeat === 'one' ? saved.repeat : 'off',
      shuffle: Boolean(saved.shuffle),
      volume: Math.min(1, Math.max(0, Number(saved.volume ?? 1))),
      rate: RATES.find((rate) => rate === Number(saved.rate)) ?? 1,
    };
  } catch {
    return empty;
  }
}

let state = restore();
let audio: HTMLAudioElement | null = null;
let loaded: string | null = null;
let lastSaved = 0;
let lastRemote = 0;
let counted: string | null = null;
let sleepTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function persist() {
  try {
    if (!state.queue.length) {
      localStorage.removeItem(STORAGE);
      return;
    }
    const { queue, original, index, time, repeat, shuffle, volume, rate } = state;
    localStorage.setItem(STORAGE, JSON.stringify({ queue, original, index, time, repeat, shuffle, volume, rate }));
  } catch {
    return;
  }
}

function patch(next: Partial<PlayerState>, save = true) {
  state = { ...state, ...next };
  if (save) persist();
  listeners.forEach((listener) => listener());
}

const current = () => state.queue[state.index] ?? null;

function remember(force = false) {
  const track = current();
  if (!audio || !track || !Number.isFinite(audio.duration) || audio.duration < LONG || audio.played.length === 0) return;
  if (!force && Date.now() - lastRemote < 15_000) return;
  lastRemote = Date.now();
  storePosition(track, audio.ended ? audio.duration : audio.currentTime, audio.duration, force);
}

function describe(track: Item) {
  const info = state.info[track.id];
  const session = navigator.mediaSession;
  if (!session || typeof MediaMetadata === 'undefined') return;
  session.metadata = new MediaMetadata({
    title: info?.title || track.name,
    artist: info?.artist ?? '',
    album: info?.album ?? '',
    artwork: track.thumb ? [{ src: new URL(thumbUrl(track), location.origin).href, sizes: '512x512', type: 'image/webp' }] : [],
  });
}

function fetchInfo(track: Item) {
  if (state.info[track.id]) return Promise.resolve();
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return api
    .get<{ meta: Record<string, unknown> }>(`/api/nodes/${track.id}/meta`)
    .then((result) => {
      const info = { title: text(result.meta.title), artist: text(result.meta.artist), album: text(result.meta.album) };
      patch({ info: { ...state.info, [track.id]: info } }, false);
      if (current()?.id === track.id) describe(track);
    })
    .catch(() => patch({ info: { ...state.info, [track.id]: { title: '', artist: '', album: '' } } }, false));
}

export const ensureInfo = (track: Item) => fetchInfo(track);

let prefetching = false;

export async function prefetchInfo() {
  if (prefetching) return;
  prefetching = true;
  try {
    const wanted = state.queue.filter((item) => !state.info[item.id]).slice(0, 100);
    for (let index = 0; index < wanted.length; index += 4) await Promise.all(wanted.slice(index, index + 4).map(fetchInfo));
  } finally {
    prefetching = false;
  }
}

function ensure() {
  if (audio) return audio;
  const element = new Audio();
  element.preload = 'metadata';
  element.volume = state.volume;
  element.addEventListener('timeupdate', () => {
    const now = Date.now();
    patch({ time: element.currentTime }, now - lastSaved > 5000);
    if (now - lastSaved > 5000) lastSaved = now;
    remember();
    count(element);
    if (navigator.mediaSession?.setPositionState && Number.isFinite(element.duration) && element.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: element.duration,
          position: element.currentTime,
          playbackRate: element.playbackRate,
        });
      } catch {
        return;
      }
    }
  });
  element.addEventListener('durationchange', () => patch({ duration: Number.isFinite(element.duration) ? element.duration : 0 }, false));
  element.addEventListener('play', () => patch({ playing: true }, false));
  element.addEventListener('pause', () => {
    patch({ playing: false, time: element.currentTime });
    remember(true);
  });
  element.addEventListener('ended', () => {
    remember(true);
    count(element, true);
    if (state.sleep && 'track' in state.sleep) {
      patch({ playing: false, time: 0, sleep: null });
      return;
    }
    if (state.index < state.queue.length - 1) jump(state.index + 1);
    else if (state.repeat === 'all' && state.queue.length) jump(0);
    else patch({ playing: false, time: 0 });
  });
  element.addEventListener('error', () => {
    const track = current();
    if (!track || !element.src) return;
    toast(t('„{name}“ lässt sich nicht abspielen', { name: track.name }));
    loaded = null;
    if (state.index < state.queue.length - 1) setTimeout(() => jump(state.index + 1), 600);
    else patch({ playing: false });
  });
  document.addEventListener(
    'play',
    (event) => {
      if (event.target !== element && event.target instanceof HTMLMediaElement) element.pause();
    },
    true
  );
  const session = navigator.mediaSession;
  if (session) {
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => void resume()],
      ['pause', () => pause()],
      ['previoustrack', () => previous()],
      ['nexttrack', () => next()],
      ['seekto', (details) => seek(details.seekTime ?? 0)],
      ['seekbackward', () => seek(element.currentTime - 10)],
      ['seekforward', () => seek(element.currentTime + 10)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        continue;
      }
    }
  }
  audio = element;
  return element;
}

function count(element: HTMLAudioElement, ended = false) {
  const track = current();
  if (!track || counted === track.id || loaded !== track.id) return;
  const length = Number.isFinite(element.duration) ? element.duration : 0;
  if (!ended && element.currentTime < 30 && (length <= 0 || element.currentTime < length / 2)) return;
  counted = track.id;
  api.post('/api/music/played', { id: track.id }).catch(() => undefined);
}

function load(autoplay: boolean, at = 0) {
  const track = current();
  const element = ensure();
  if (!track) return;
  loaded = track.id;
  counted = null;
  element.src = contentUrl(track);
  element.defaultPlaybackRate = state.rate;
  element.playbackRate = state.rate;
  element.loop = state.repeat === 'one' && !(state.sleep && 'track' in state.sleep);
  patch({ time: at, duration: 0 }, false);
  void fetchInfo(track);
  describe(track);
  const start = () => {
    if (at > 0) element.currentTime = at;
    else if (Number.isFinite(element.duration) && element.duration >= LONG) {
      loadPosition(track)
        .then((position) => {
          if (position && loaded === track.id && element.currentTime < 5) element.currentTime = position.seconds;
        })
        .catch(() => undefined);
    }
  };
  element.addEventListener('loadedmetadata', start, { once: true });
  if (autoplay) element.play().catch(() => patch({ playing: false }, false));
}

export function playItems(items: Item[], start?: Item) {
  const queue = items
    .filter((item) => item.type === 'file' && item.kind === 'audio' && !item.infected)
    .slice(0, MAX_QUEUE)
    .map(slim);
  if (!queue.length) return;
  remember(true);
  const index = Math.max(
    0,
    queue.findIndex((item) => item.id === start?.id)
  );
  patch({ queue, original: null, shuffle: false, index });
  load(true);
}

export function enqueue(items: Item[]) {
  const known = new Set(state.queue.map((item) => item.id));
  const extra = items.filter((item) => item.type === 'file' && item.kind === 'audio' && !item.infected && !known.has(item.id)).map(slim);
  if (!extra.length) return 0;
  const empty = !state.queue.length;
  patch({
    queue: [...state.queue, ...extra].slice(0, MAX_QUEUE),
    original: state.original ? [...state.original, ...extra].slice(0, MAX_QUEUE) : null,
  });
  if (empty) load(true);
  return extra.length;
}

export async function resume() {
  const element = ensure();
  if (!current()) return;
  if (loaded !== current()!.id) load(true, state.time);
  else await element.play().catch(() => undefined);
}

export function pause() {
  audio?.pause();
}

export function toggle() {
  if (state.playing) pause();
  else void resume();
}

export function jump(index: number) {
  if (index < 0 || index >= state.queue.length) return;
  remember(true);
  patch({ index, time: 0 });
  load(true);
}

export function next() {
  if (state.index < state.queue.length - 1) jump(state.index + 1);
  else if (state.repeat === 'all' && state.queue.length) jump(0);
}

export function previous() {
  if (audio && audio.currentTime > 3) {
    seek(0);
    return;
  }
  if (state.index > 0) jump(state.index - 1);
  else if (state.repeat === 'all' && state.queue.length) jump(state.queue.length - 1);
  else seek(0);
}

export function seek(seconds: number) {
  const element = ensure();
  if (loaded !== current()?.id) {
    patch({ time: Math.max(0, seconds) });
    return;
  }
  element.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(element.duration) ? element.duration : seconds));
  patch({ time: element.currentTime }, false);
}

export function setVolume(volume: number) {
  const value = Math.min(1, Math.max(0, volume));
  ensure().volume = value;
  patch({ volume: value });
}

export function setRate(rate: number) {
  const value = RATES.find((entry) => entry === rate) ?? 1;
  if (audio) {
    audio.defaultPlaybackRate = value;
    audio.playbackRate = value;
  }
  patch({ rate: value });
}

function fadeOut() {
  const element = audio;
  if (!element || element.paused) {
    patch({ sleep: null });
    return;
  }
  const volume = state.volume;
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    element.volume = Math.max(0, volume * (1 - step / 20));
    if (step < 20) return;
    clearInterval(timer);
    element.pause();
    element.volume = volume;
    patch({ sleep: null });
  }, 150);
}

export function setSleep(choice: number | 'track' | null) {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  if (choice === null) {
    if (audio) audio.loop = state.repeat === 'one';
    patch({ sleep: null }, false);
    return;
  }
  if (choice === 'track') {
    if (audio) audio.loop = false;
    patch({ sleep: { track: true } }, false);
    return;
  }
  const minutes = Math.min(600, Math.max(1, choice));
  if (audio) audio.loop = state.repeat === 'one';
  sleepTimer = setTimeout(fadeOut, minutes * 60_000);
  patch({ sleep: { until: Date.now() + minutes * 60_000 } }, false);
}

export function cycleRepeat() {
  const repeat: Repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  if (audio) audio.loop = repeat === 'one' && !(state.sleep && 'track' in state.sleep);
  patch({ repeat });
}

export function toggleShuffle() {
  const track = current();
  if (!track) return;
  if (state.shuffle) {
    const queue = state.original ?? state.queue;
    patch({
      shuffle: false,
      original: null,
      queue,
      index: Math.max(
        0,
        queue.findIndex((item) => item.id === track.id)
      ),
    });
    return;
  }
  const rest = state.queue.filter((item) => item.id !== track.id);
  for (let index = rest.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [rest[index], rest[other]] = [rest[other], rest[index]];
  }
  patch({ shuffle: true, original: state.queue, queue: [track, ...rest], index: 0 });
}

export function remove(index: number) {
  const target = state.queue[index];
  if (!target) return;
  const queue = state.queue.filter((_item, position) => position !== index);
  const original = state.original?.filter((item) => item.id !== target.id) ?? null;
  if (!queue.length) {
    clear();
    return;
  }
  if (index === state.index) {
    patch({ queue, original, index: Math.min(index, queue.length - 1), time: 0 });
    load(state.playing);
    return;
  }
  patch({ queue, original, index: index < state.index ? state.index - 1 : state.index });
}

export function clear() {
  remember(true);
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  loaded = null;
  if (navigator.mediaSession) navigator.mediaSession.metadata = null;
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  patch({ queue: [], original: null, index: 0, playing: false, time: 0, duration: 0, shuffle: false, sleep: null });
}

export function forget(ids: string[]) {
  const gone = new Set(ids);
  if (!state.queue.some((item) => gone.has(item.id))) return;
  const playingGone = current() ? gone.has(current()!.id) : false;
  const queue = state.queue.filter((item) => !gone.has(item.id));
  if (!queue.length) {
    clear();
    return;
  }
  const keep = current();
  const index = keep && !playingGone ? queue.findIndex((item) => item.id === keep.id) : Math.min(state.index, queue.length - 1);
  patch({ queue, original: state.original?.filter((item) => !gone.has(item.id)) ?? null, index });
  if (playingGone) load(state.playing);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const usePlayer = () => useSyncExternalStore(subscribe, () => state);

export const playerState = () => state;
