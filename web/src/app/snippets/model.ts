import { api } from '../../lib/api';
import { t } from '../../lib/i18n';

export interface Snippet {
  id: string;
  title: string;
  language: string;
  content?: string;
  preview?: string;
  size: number;
  lines: number;
  shared: boolean;
  link: string | null;
  protected: boolean;
  burn: boolean;
  expiresAt: number | null;
  views: number;
  viewedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ShareInput {
  shared: boolean;
  password?: string | null;
  expiresAt?: number | null;
  burn?: boolean;
  renew?: boolean;
}

export const snippetsApi = {
  list: (q?: string) => api.get<{ snippets: Snippet[] }>(`/api/snippets${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  get: (id: string) => api.get<{ snippet: Snippet }>(`/api/snippets/${id}`),
  create: (input: { title: string; language: string; content: string }) => api.post<{ snippet: Snippet }>('/api/snippets', input),
  update: (id: string, patch: Partial<{ title: string; language: string; content: string }>) =>
    api.patch<{ snippet: Snippet }>(`/api/snippets/${id}`, patch),
  remove: (id: string) => api.delete(`/api/snippets/${id}`),
  share: (id: string, input: ShareInput) => api.put<{ snippet: Snippet }>(`/api/snippets/${id}/share`, input),
  save: (id: string) =>
    api.post<{ node: { id: string; name: string }; folder: { id: string; name: string } }>(`/api/snippets/${id}/save`, {}),
};

export const LANGUAGE_NAMES: [string, string][] = [
  ['auto', t('Automatisch erkennen')],
  ['text', t('Nur Text')],
  ['markdown', 'Markdown'],
  ['javascript', 'JavaScript'],
  ['typescript', 'TypeScript'],
  ['json', 'JSON'],
  ['html', 'HTML'],
  ['css', 'CSS'],
  ['scss', 'SCSS'],
  ['python', 'Python'],
  ['bash', 'Bash'],
  ['powershell', 'PowerShell'],
  ['sql', 'SQL'],
  ['yaml', 'YAML'],
  ['ini', 'INI / TOML'],
  ['dockerfile', 'Dockerfile'],
  ['nginx', 'nginx'],
  ['go', 'Go'],
  ['rust', 'Rust'],
  ['java', 'Java'],
  ['kotlin', 'Kotlin'],
  ['swift', 'Swift'],
  ['c', 'C'],
  ['cpp', 'C++'],
  ['csharp', 'C#'],
  ['php', 'PHP'],
  ['ruby', 'Ruby'],
  ['lua', 'Lua'],
  ['diff', 'Diff'],
  ['xml', 'XML'],
];

export const languageName = (key: string) => LANGUAGE_NAMES.find(([value]) => value === key)?.[1] ?? key;

export const EXPIRY: [string, number | null][] = [
  [t('Nie'), null],
  [t('1 Stunde'), 3_600_000],
  [t('1 Tag'), 86_400_000],
  [t('1 Woche'), 7 * 86_400_000],
  [t('1 Monat'), 30 * 86_400_000],
];
