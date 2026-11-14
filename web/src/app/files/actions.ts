import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { splitExtension } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { navigate } from '../../lib/router';
import { confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';
import { contentUrl, type Item } from './kinds';
import { folderHref } from './model';

export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    toast(errorText(error));
    return undefined;
  }
}

export function savedToast(node: Item, message = t('Gespeichert als „{name}“', { name: node.name })) {
  const rootId = boot().user?.rootId;
  const href = node.parentId && rootId ? folderHref(node.parentId, rootId) : null;
  if (!href || location.pathname.replace(/\/+$/, '') === href) return toast(message);
  toast(message, { action: { label: t('Zeigen'), onClick: () => navigate(`${href}?select=${node.id}`) } });
}

export function triggerDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.dispatchEvent(new CustomEvent('moe:download', { detail: url }));
}

export function download(items: Item[], base = '/api') {
  if (items.length === 0) return;
  if (items.length === 1 && items[0].type === 'file') triggerDownload(contentUrl(items[0], base, true));
  else triggerDownload(`${base}/zip?ids=${items.map((item) => item.id).join(',')}`);
}

export async function renameItem(item: Item) {
  const [base] = splitExtension(item.name);
  const name = await prompt({
    title: t('Umbenennen'),
    label: t('Name'),
    value: item.name,
    select: [0, item.type === 'folder' ? item.name.length : base.length],
    confirm: t('Umbenennen'),
  });
  if (!name || name === item.name) return false;
  return Boolean(
    await attempt(async () => {
      await api.patch(`/api/nodes/${item.id}`, { name });
      return true;
    })
  );
}

export async function trashItems(items: Item[], onUndo?: () => void) {
  const ids = items.map((item) => item.id);
  const done = await attempt(async () => {
    await api.post('/api/nodes/trash', { ids });
    return true;
  });
  if (!done) return false;
  toast(tn(items.length, '„{name}“ liegt im Papierkorb', '{count} Elemente liegen im Papierkorb', { name: items[0].name }), {
    action: {
      label: t('Rückgängig'),
      onClick: () =>
        void attempt(async () => {
          await api.post('/api/nodes/restore', { ids });
          onUndo?.();
        }),
    },
  });
  return true;
}

export async function restoreItems(items: Item[]) {
  const done = await attempt(async () => {
    await api.post('/api/nodes/restore', { ids: items.map((item) => item.id) });
    return true;
  });
  if (done) toast(tn(items.length, '„{name}“ ist wieder da', '{count} Elemente sind wieder da', { name: items[0].name }));
  return Boolean(done);
}

export async function deleteForever(items: Item[]) {
  const ok = await confirm({
    title: tn(items.length, '„{name}“ endgültig löschen?', '{count} Elemente endgültig löschen?', { name: items[0]?.name ?? '' }),
    text: t('Das lässt sich nicht rückgängig machen.'),
    confirm: t('Endgültig löschen'),
    danger: true,
  });
  if (!ok) return false;
  const done = await attempt(async () => {
    await api.post('/api/nodes/delete', { ids: items.map((item) => item.id) });
    return true;
  });
  if (done) toast(tn(items.length, 'Endgültig gelöscht', '{count} Elemente endgültig gelöscht'));
  return Boolean(done);
}

export async function emptyTrash() {
  const ok = await confirm({
    title: t('Papierkorb leeren?'),
    text: t('Alles im Papierkorb wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.'),
    confirm: t('Papierkorb leeren'),
    danger: true,
  });
  if (!ok) return false;
  const done = await attempt(() => api.delete('/api/trash'));
  if (done !== undefined) toast(t('Der Papierkorb ist leer'));
  return done !== undefined;
}

export async function starItems(items: Item[], starred: boolean) {
  await attempt(async () => {
    for (const item of items) await api.put(`/api/nodes/${item.id}/star`, { starred });
  });
  toast(starred ? t('Zu Favoriten hinzugefügt') : t('Aus Favoriten entfernt'));
}

export async function createFolder(parentId: string) {
  const name = await prompt({ title: t('Neuer Ordner'), label: t('Name'), value: t('Neuer Ordner'), confirm: t('Erstellen') });
  if (!name) return null;
  return (await attempt(() => api.post<{ node: Item }>(`/api/nodes/${parentId}/folders`, { name })))?.node ?? null;
}

export async function importFromUrl(parentId: string) {
  const url = await prompt({
    title: t('Aus dem Internet laden'),
    label: t('Adresse'),
    value: '',
    confirm: t('Laden'),
    helper: t('MoeCloud lädt die Datei selbst herunter und legt sie in diesen Ordner.'),
  });
  if (!url?.trim()) return false;
  const started = await attempt(() => api.post<{ job: { id: string } }>(`/api/nodes/${parentId}/import`, { url: url.trim() }));
  if (!started) return false;
  toast(t('Der Download läuft. Ist er fertig, siehst du es unter Benachrichtigungen.'));
  return true;
}

export async function createTextFile(parentId: string) {
  const name = await prompt({
    title: t('Neue Textdatei'),
    label: t('Name'),
    value: t('Notiz.md'),
    select: [0, t('Notiz.md').lastIndexOf('.')],
    confirm: t('Erstellen'),
    helper: t('Mit .md schreibst du in Markdown, mit .txt als reinen Text.'),
  });
  if (!name) return null;
  return (await attempt(() => api.post<{ node: Item }>(`/api/nodes/${parentId}/text`, { name, content: '' })))?.node ?? null;
}

export async function leaveShare(item: Item) {
  if (!item.grantId) return false;
  const ok = await confirm({
    title: t('Freigabe verlassen?'),
    text: t('„{name}“ verschwindet aus deiner Liste. Die Person, der es gehört, kann es dir wieder freigeben.', { name: item.name }),
    confirm: t('Verlassen'),
  });
  if (!ok) return false;
  return Boolean(await attempt(() => api.delete(`/api/grants/${item.grantId}`).then(() => true)));
}

export interface ExtractResult {
  folderId: string;
  files: number;
  folders: number;
  skipped: { infected: number; encrypted: number; unsafe: number; tooLarge: number };
  folder: Item;
}

export async function extract(item: Item) {
  toast(t('„{name}“ wird entpackt', { name: item.name }), { duration: 2500 });
  const result = await attempt(() => api.post<ExtractResult>(`/api/nodes/${item.id}/extract`, {}));
  if (!result) return null;
  const { infected, encrypted, unsafe, tooLarge } = result.skipped;
  const other = encrypted + unsafe + tooLarge;
  return {
    result,
    message: [
      tn(result.files, 'Eine Datei entpackt.', '{count} Dateien entpackt.'),
      infected ? tn(infected, 'Eine Datei enthielt Schadsoftware.', '{count} Dateien enthielten Schadsoftware.') : '',
      other ? tn(other, 'Eine Datei wurde übersprungen.', '{count} Dateien wurden übersprungen.') : '',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
