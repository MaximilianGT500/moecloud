import { boot } from './boot';
import { t } from './i18n';

export class ApiError extends Error {
  status: number;
  code: string;
  data: Record<string, unknown>;

  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = String(data.code ?? 'error');
    this.data = data;
  }
}

let csrf = boot().csrf ?? '';

export const csrfToken = () => csrf;
export const setCsrf = (value: string) => {
  csrf = value;
};

export async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError(0, t('Keine Verbindung zum Server, prüf dein Netz'));
  }
  if (!response.ok) {
    let data: { error?: Record<string, unknown> } = {};
    try {
      data = await response.json();
    } catch {}
    if (response.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/public/') && boot().user) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    throw new ApiError(
      response.status,
      String(data.error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal')),
      data.error ?? {}
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(url: string, signal?: AbortSignal) => request<T>('GET', url, undefined, signal),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  delete: <T>(url: string) => request<T>('DELETE', url),
};

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : t('Da ist etwas schiefgelaufen, versuch es noch einmal');

export async function logout() {
  try {
    const result = await fetch('/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = (await result.json()) as { redirect?: string };
    location.href = data.redirect ?? '/login';
  } catch {
    location.href = '/login';
  }
}
