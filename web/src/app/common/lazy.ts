import { lazy, type ComponentType } from 'react';

type Component = ComponentType<any>;

const RELOADED = 'moecloud-reloaded';

function retry<M>(load: () => Promise<M>) {
  return load()
    .then((module) => {
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {}
      return module;
    })
    .catch((error: unknown) => {
      let reloaded = false;
      try {
        reloaded = sessionStorage.getItem(RELOADED) === location.pathname;
        if (!reloaded) sessionStorage.setItem(RELOADED, location.pathname);
      } catch {}
      if (reloaded) throw error;
      location.reload();
      return new Promise<M>(() => undefined);
    });
}

export function lazyNamed<M extends { [P in K]: Component }, K extends keyof M>(load: () => Promise<M>, name: K) {
  let pending: Promise<M> | null = null;
  const preload = () => (pending ??= retry(load));
  return Object.assign(
    lazy(() => preload().then((module) => ({ default: module[name] }))),
    { preload }
  );
}

export function whenIdle(task: () => void) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(task, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(task, 1500);
  return () => window.clearTimeout(id);
}
