import { config } from '../config.ts';

export const userAgent = () => `MoeCloud/${config.version} (+https://github.com/MaximilianGT500/moecloud)`;

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  timeout?: number;
  maxBytes?: number;
}

export interface FetchResult {
  status: number;
  ok: boolean;
  text: string;
  headers: Headers;
}

export function checkUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Nur http- und https-Adressen sind erlaubt');
  if (url.username || url.password) throw new Error('Zugangsdaten gehören nicht in die Adresse');
  return url;
}

export async function request(target: string, options: FetchOptions = {}): Promise<FetchResult> {
  const url = checkUrl(target);
  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'User-Agent': userAgent(), Accept: 'application/json, text/plain;q=0.9, */*;q=0.5', ...options.headers },
    body: options.body,
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeout ?? 8000),
  });
  const limit = options.maxBytes ?? 1024 * 1024;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Die Antwort ist zu groß');
      }
      chunks.push(value);
    }
  }
  return { status: response.status, ok: response.ok, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers };
}

export async function requestJson<T>(target: string, options: FetchOptions = {}): Promise<T> {
  const result = await request(target, options);
  if (!result.ok) throw new Error(`HTTP ${result.status}`);
  return JSON.parse(result.text) as T;
}
