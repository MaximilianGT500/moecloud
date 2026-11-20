const CACHE = 'moe-share';

export interface Shared {
  files: File[];
  title: string;
  text: string;
  url: string;
}

export async function takeShared(): Promise<Shared | null> {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(CACHE);
    const stored = await cache.match('/__share/meta');
    if (!stored) return null;
    const meta = (await stored.json()) as { title?: string; text?: string; url?: string; files?: number };
    const files: File[] = [];
    for (let index = 0; index < Math.min(50, Number(meta.files) || 0); index++) {
      const entry = await cache.match(`/__share/file/${index}`);
      if (!entry) continue;
      const blob = await entry.blob();
      const name = decodeURIComponent(entry.headers.get('X-Name') ?? '') || `Datei ${index + 1}`;
      files.push(new File([blob], name, { type: entry.headers.get('Content-Type') ?? blob.type }));
    }
    for (const key of await cache.keys()) await cache.delete(key);
    return { files, title: String(meta.title ?? ''), text: String(meta.text ?? ''), url: String(meta.url ?? '') };
  } catch {
    return null;
  }
}

export function registerWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}
