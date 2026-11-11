import { useSyncExternalStore } from 'react';
import { ApiError, csrfToken, request } from './api';
import { t } from './i18n';

export interface UploadEntry {
  file: File;
  relativePath?: string;
  name?: string;
}

export type UploadStatus = 'queued' | 'uploading' | 'processing' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  loaded: number;
  status: UploadStatus;
  error?: string;
  parentId: string;
  relativePath?: string;
  nodeId?: string;
  file: File;
  conflict: 'rename' | 'replace';
  uploadId?: string;
  chunkSize: number;
  attempts: number;
}

let counter = 0;

export class Uploader {
  base: string;
  items: UploadItem[] = [];
  version = 0;
  onDone?: (item: UploadItem) => void;
  private listeners = new Set<() => void>();
  private active = 0;
  private requests = new Map<string, XMLHttpRequest>();
  private cancelled = new Set<string>();
  private lastEmit = 0;

  constructor(base = '/api') {
    this.base = base;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  snapshot = () => this.version;

  private emit(throttle = false) {
    const now = performance.now();
    if (throttle && now - this.lastEmit < 120) return;
    this.lastEmit = now;
    this.version++;
    this.items = [...this.items];
    for (const listener of this.listeners) listener();
  }

  private update(key: string, patch: Partial<UploadItem>, throttle = false) {
    const index = this.items.findIndex((item) => item.key === key);
    if (index === -1) return;
    this.items[index] = { ...this.items[index], ...patch };
    this.emit(throttle);
  }

  private get(key: string) {
    return this.items.find((item) => item.key === key);
  }

  add(entries: UploadEntry[], parentId: string, conflict: 'rename' | 'replace' = 'rename') {
    for (const entry of entries) {
      this.items.push({
        key: `u${++counter}`,
        name: entry.name ?? entry.file.name,
        size: entry.file.size,
        loaded: 0,
        status: 'queued',
        parentId,
        relativePath: entry.relativePath,
        file: entry.file,
        conflict,
        chunkSize: 16 * 1024 * 1024,
        attempts: 0,
      });
    }
    this.emit();
    this.pump();
  }

  cancel(key: string) {
    const item = this.get(key);
    if (!item || item.status === 'done') return;
    this.cancelled.add(key);
    this.requests.get(key)?.abort();
    if (item.status === 'queued' || item.status === 'error') {
      this.update(key, { status: 'cancelled' });
      if (item.uploadId) void request('DELETE', `${this.base}/uploads/${item.uploadId}`).catch(() => {});
    }
  }

  cancelAll() {
    for (const item of this.items) if (['queued', 'uploading', 'error'].includes(item.status)) this.cancel(item.key);
  }

  retry(key: string) {
    const item = this.get(key);
    if (!item || (item.status !== 'error' && item.status !== 'cancelled')) return;
    this.cancelled.delete(key);
    this.update(key, {
      status: 'queued',
      error: undefined,
      attempts: 0,
      ...(item.status === 'cancelled' ? { uploadId: undefined, loaded: 0 } : {}),
    });
    this.pump();
  }

  clear() {
    this.items = this.items.filter((item) => !['done', 'cancelled'].includes(item.status));
    this.emit();
  }

  private pump() {
    while (this.active < 3) {
      const next = this.items.find((item) => item.status === 'queued');
      if (!next) break;
      this.active++;
      this.update(next.key, { status: 'uploading' });
      void this.run(next.key).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(key: string): Promise<void> {
    let item = this.get(key)!;
    try {
      if (!item.uploadId) {
        const init = await request<{ id: string; chunkSize: number }>('POST', `${this.base}/uploads`, {
          parentId: item.parentId,
          name: item.name,
          size: item.size,
          modifiedAt: item.file.lastModified || null,
          relativePath: item.relativePath ?? null,
          conflict: item.conflict,
        });
        this.update(key, { uploadId: init.id, chunkSize: init.chunkSize, loaded: 0 });
      } else {
        const status = await request<{ received: number }>('GET', `${this.base}/uploads/${item.uploadId}`);
        this.update(key, { loaded: status.received });
      }
      item = this.get(key)!;
      while (item.loaded < item.size) {
        if (this.cancelled.has(key)) throw new DOMException('cancelled', 'AbortError');
        const end = Math.min(item.size, item.loaded + item.chunkSize);
        const received = await this.chunk(item, item.loaded, item.file.slice(item.loaded, end));
        this.update(key, { loaded: received });
        item = this.get(key)!;
      }
      this.update(key, { status: 'processing' });
      const result = await request<{ node: { id: string } }>('POST', `${this.base}/uploads/${item.uploadId}/complete`);
      this.update(key, { status: 'done', nodeId: result.node.id, loaded: item.size });
      this.onDone?.(this.get(key)!);
    } catch (error) {
      const current = this.get(key);
      if (!current) return;
      if (this.cancelled.has(key) || (error as Error).name === 'AbortError') {
        this.update(key, { status: 'cancelled' });
        if (current.uploadId) void request('DELETE', `${this.base}/uploads/${current.uploadId}`).catch(() => {});
        return;
      }
      const status = error instanceof ApiError ? error.status : 0;
      if ((status === 0 || status >= 500) && status !== 507 && current.attempts < 4) {
        this.update(key, { attempts: current.attempts + 1 });
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** current.attempts));
        if (!this.cancelled.has(key)) return this.run(key);
      }
      this.update(key, { status: 'error', error: (error as Error).message || t('Hochladen fehlgeschlagen') });
    }
  }

  private chunk(item: UploadItem, offset: number, blob: Blob): Promise<number> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.requests.set(item.key, xhr);
      xhr.open('PUT', `${this.base}/uploads/${item.uploadId}?offset=${offset}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-CSRF-Token', csrfToken());
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (event) => this.update(item.key, { loaded: offset + event.loaded }, true);
      xhr.onload = () => {
        this.requests.delete(item.key);
        let data: { received?: number; error?: { message?: string; received?: number } } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status === 200 && typeof data.received === 'number') resolve(data.received);
        else if (xhr.status === 409 && typeof data.error?.received === 'number') resolve(data.error.received);
        else reject(new ApiError(xhr.status, data.error?.message ?? t('Hochladen fehlgeschlagen')));
      };
      xhr.onerror = () => {
        this.requests.delete(item.key);
        reject(new ApiError(0, t('Keine Verbindung zum Server, prüf dein Netz')));
      };
      xhr.onabort = () => {
        this.requests.delete(item.key);
        reject(new DOMException('cancelled', 'AbortError'));
      };
      xhr.send(blob);
    });
  }
}

export function useUploads(uploader: Uploader) {
  useSyncExternalStore(uploader.subscribe, uploader.snapshot);
  return uploader.items;
}

export function entriesFromInput(files: FileList | File[]): UploadEntry[] {
  return [...files].map((file) => {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    return { file, relativePath: folder || undefined };
  });
}

const pad = (value: number) => String(value).padStart(2, '0');

export function entriesFromPaste(transfer: DataTransfer | null, now = new Date()): UploadEntry[] {
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  return [...(transfer?.files ?? [])].map((file) => {
    const generic = /^image(\.[a-z0-9]+)$/i.exec(file.name);
    return generic ? { file, name: `${t('Eingefügtes Bild')} ${stamp}${generic[1].toLowerCase()}` } : { file };
  });
}

export function entriesFromDrop(transfer: DataTransfer): Promise<UploadEntry[]> {
  const roots = [...transfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  const plain = [...transfer.files];
  if (roots.length === 0) return Promise.resolve(plain.map((file) => ({ file })));
  const out: UploadEntry[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, relativePath: path || undefined });
      return;
    }
    if (!entry.isDirectory) return;
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const folder = path ? `${path}/${entry.name}` : entry.name;
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, folder);
    }
  };
  return (async () => {
    for (const root of roots) await walk(root, '');
    return out;
  })();
}

export const hasFiles = (transfer: DataTransfer | null) => Boolean(transfer && [...transfer.types].includes('Files'));
