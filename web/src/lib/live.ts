import { useEffect, useRef } from 'react';

type Handler = (event: string, data: Record<string, unknown>) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;
let greeted = false;

function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/events');
  for (const name of ['change', 'shared', 'notification', 'comment']) {
    source.addEventListener(name, (event) => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse((event as MessageEvent<string>).data);
      } catch {}
      for (const handler of handlers) handler(name, data);
    });
  }
  source.addEventListener('hello', () => {
    if (!greeted) {
      greeted = true;
      return;
    }
    for (const handler of handlers) handler('reconnect', {});
  });
}

export function useLive(handler: Handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const listener: Handler = (event, data) => ref.current(event, data);
    handlers.add(listener);
    connect();
    return () => {
      handlers.delete(listener);
    };
  }, []);
}
