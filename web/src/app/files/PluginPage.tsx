import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import { useColorScheme, useTheme } from '@mui/material/styles';
import ExtensionOffRounded from '@mui/icons-material/ExtensionOffRounded';
import { csrfToken } from '../../lib/api';
import { boot } from '../../lib/boot';
import { language, t } from '../../lib/i18n';
import { navigate } from '../../lib/router';
import { EXTRA_ROLES, ROLES } from '../../theme/scheme';
import { fonts } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { pluginPages } from '../common/plugins';
import { toast } from '../common/toast';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';

interface BridgeError {
  message: string;
  status: number;
  code: string;
  data?: unknown;
}

function snapshot() {
  const root = getComputedStyle(document.documentElement);
  const colors: Record<string, string> = {};
  for (const role of [...ROLES, ...EXTRA_ROLES]) {
    const value = root.getPropertyValue(`--mui-palette-m3-${role}`).trim();
    if (value) colors[role] = value;
  }
  const main = document.getElementById('inhalt');
  const painted = main ? getComputedStyle(main).backgroundColor : '';
  return {
    mode: document.documentElement.getAttribute('data-mui-color-scheme') === 'light' ? 'light' : 'dark',
    colors,
    background: painted && !/^rgba\(0, 0, 0, 0\)$|^transparent$/.test(painted) ? painted : (colors.surface ?? ''),
    font: getComputedStyle(document.body).fontFamily,
    mono: fonts.mono,
    corners: Number(root.getPropertyValue('--moe-corners')) || 1,
  };
}

const failure = (message: string, status = 0, code = 'bad_request', data?: unknown): BridgeError => ({ message, status, code, data });

async function callApi(plugin: string, method: unknown, path: unknown, body: unknown) {
  const verb = String(method ?? 'GET').toUpperCase();
  if (!METHODS.has(verb)) throw failure(t('Diese Methode kennt MoeCloud nicht'));
  const base = `/api/ext/${plugin}`;
  const raw = String(path ?? '/');
  let url: URL;
  try {
    url = new URL(base + (raw.startsWith('/') ? raw : `/${raw}`), location.origin);
  } catch {
    throw failure(t('Dieser Pfad ist ungültig'));
  }
  if (url.origin !== location.origin || (url.pathname !== base && !url.pathname.startsWith(`${base}/`))) {
    throw failure(t('Eine Seite erreicht nur die Routen ihres eigenen Plugins'), 0, 'forbidden');
  }
  const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' };
  let payload: BodyInit | undefined;
  if (verb !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken();
    if (typeof body === 'string') {
      headers['Content-Type'] = 'text/plain; charset=utf-8';
      payload = body;
    } else if (body instanceof ArrayBuffer || body instanceof Blob) {
      headers['Content-Type'] = 'application/octet-stream';
      payload = body;
    } else if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  let response: Response;
  try {
    response = await fetch(url.pathname + url.search, { method: verb, credentials: 'same-origin', headers, body: payload });
  } catch {
    throw failure(t('Keine Verbindung zum Server, prüf dein Netz'), 0, 'offline');
  }
  const type = response.headers.get('content-type') ?? '';
  let data: unknown = null;
  if (response.status !== 204) {
    if (type.includes('json')) data = await response.json().catch(() => null);
    else if (type.startsWith('text/')) data = await response.text();
    else data = await response.arrayBuffer();
  }
  if (!response.ok) {
    const error = (data as { error?: { message?: unknown; code?: unknown } } | null)?.error;
    throw failure(
      String(error?.message ?? t('Da ist etwas schiefgelaufen, versuch es noch einmal')),
      response.status,
      String(error?.code ?? 'error'),
      data
    );
  }
  return data;
}

export function PluginPageView({ plugin, page }: { plugin: string; page: string }) {
  const entry = pluginPages().find((candidate) => candidate.plugin === plugin && candidate.id === page) ?? null;
  const frame = useRef<HTMLIFrameElement>(null);
  const greeted = useRef(false);
  const [height, setHeight] = useState<number | null>(null);
  const theme = useTheme();
  const { mode, systemMode } = useColorScheme();
  const pluginId = entry?.plugin ?? '';
  const pageId = entry?.id ?? '';

  useEffect(() => {
    if (!pluginId) return;
    greeted.current = false;
    const answer = (id: unknown, result: unknown, error?: BridgeError) =>
      frame.current?.contentWindow?.postMessage(error ? { moecloud: 1, reply: id, error } : { moecloud: 1, reply: id, result }, '*');
    const pushTheme = () => {
      if (greeted.current) frame.current?.contentWindow?.postMessage({ moecloud: 1, type: 'theme', theme: snapshot() }, '*');
    };
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target) return;
      const message = event.data as { moecloud?: unknown; id?: unknown; type?: unknown; [key: string]: unknown } | null;
      if (!message || message.moecloud !== 1 || typeof message.type !== 'string') return;
      const user = boot().user;
      if (message.type === 'hello') {
        greeted.current = true;
        answer(message.id, {
          plugin: pluginId,
          page: pageId,
          lang: language,
          site: { name: boot().site.name, url: boot().site.url, version: boot().site.version },
          user: user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null,
          theme: snapshot(),
        });
      } else if (message.type === 'api') {
        callApi(pluginId, message.method, message.path, message.body).then(
          (result) => answer(message.id, result),
          (error: BridgeError) => answer(message.id, null, error)
        );
      } else if (message.type === 'toast') {
        const text = String(message.text ?? '').slice(0, 300);
        if (text) toast(text);
        answer(message.id, true);
      } else if (message.type === 'open') {
        const path = String(message.path ?? '');
        if (/^\/files(\/|\?|$)/.test(path)) {
          answer(message.id, true);
          navigate(path);
        } else if (/^\/(account|admin)(\/|\?|$)/.test(path)) {
          answer(message.id, true);
          location.assign(path);
        } else {
          answer(message.id, null, failure(t('Dieser Pfad ist ungültig')));
        }
      } else if (message.type === 'resize') {
        const value = Number(message.height);
        setHeight(Number.isFinite(value) && value > 0 ? Math.min(20_000, Math.max(120, Math.round(value))) : null);
        answer(message.id, true);
      } else {
        answer(message.id, null, failure(t('Diese Nachricht kennt MoeCloud nicht'), 0, 'unknown'));
      }
    };
    const observer = new MutationObserver(pushTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-mui-color-scheme'] });
    window.addEventListener('message', onMessage);
    return () => {
      observer.disconnect();
      window.removeEventListener('message', onMessage);
    };
  }, [pluginId, pageId]);

  useEffect(() => {
    const handle = requestAnimationFrame(() => {
      if (greeted.current) frame.current?.contentWindow?.postMessage({ moecloud: 1, type: 'theme', theme: snapshot() }, '*');
    });
    return () => cancelAnimationFrame(handle);
  }, [theme, mode, systemMode]);

  if (!entry) {
    return (
      <EmptyState
        icon={<ExtensionOffRounded />}
        title={t('Diese Seite gibt es nicht mehr')}
        text={t('Das Plugin dahinter wurde abgeschaltet oder entfernt.')}
        action={
          <Button variant="tonal" onClick={() => navigate('/files')}>
            {t('Zu meinen Dateien')}
          </Button>
        }
      />
    );
  }

  return (
    <Box
      component="iframe"
      ref={frame}
      key={`${entry.plugin}/${entry.id}`}
      title={entry.label}
      src={entry.src}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      sx={{
        display: 'block',
        border: 0,
        width: '100%',
        flex: height ? 'none' : 1,
        height: height ?? { xs: 'calc(100dvh - 224px - env(safe-area-inset-bottom))', md: 'auto' },
        minHeight: height ? undefined : { md: 0 },
      }}
    />
  );
}
