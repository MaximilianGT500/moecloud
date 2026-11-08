import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { t } from '../../../lib/i18n';
import { radius } from '../../../theme/tokens';
import { contentUrl, type Item } from '../kinds';
import { Fallback } from './Fallback';

const nonce = () => (document.querySelector('meta[property="csp-nonce"]') as HTMLMetaElement | null)?.nonce || '';

export default function DocxPreview({ item, base }: { item: Item; base: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ key: string; status: 'ready' | 'error' } | null>(null);
  const key = item.id + item.version;

  useEffect(() => {
    const abort = new AbortController();
    const styles = document.createElement('div');
    const injected: HTMLStyleElement[] = [];
    (async () => {
      const response = await fetch(contentUrl(item, base), { credentials: 'same-origin', signal: abort.signal });
      if (!response.ok) throw new Error('load');
      const data = await response.arrayBuffer();
      const { renderAsync } = await import('docx-preview');
      if (abort.signal.aborted || !body.current) return;
      body.current.replaceChildren();
      await renderAsync(data, body.current, styles, {
        className: 'docx',
        inWrapper: true,
        ignoreFonts: true,
        breakPages: true,
        useBase64URL: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        experimental: false,
      });
      for (const style of styles.querySelectorAll('style')) {
        const element = document.createElement('style');
        const value = nonce();
        if (value) element.nonce = value;
        element.textContent = style.textContent;
        document.head.append(element);
        injected.push(element);
      }
      if (!abort.signal.aborted) setState({ key, status: 'ready' });
    })().catch((reason: Error) => {
      if (reason.name !== 'AbortError' && !abort.signal.aborted) setState({ key, status: 'error' });
    });
    return () => {
      abort.abort();
      for (const element of injected) element.remove();
    };
  }, [item, base, key]);

  const status = state?.key === key ? state.status : 'loading';
  if (status === 'error') return <Fallback item={item} text={t('Das Dokument lässt sich nicht anzeigen.')} />;
  return (
    <Box sx={{ position: 'relative', width: 'min(1000px, 100%)', height: '100%', minHeight: 320 }}>
      {status === 'loading' && <CircularProgress aria-label={t('Lädt')} sx={{ position: 'absolute', left: '50%', top: 80, ml: -2.5 }} />}
      <Box
        ref={body}
        tabIndex={0}
        aria-label={t('Inhalt von {name}', { name: item.name })}
        sx={{
          height: '100%',
          overflow: 'auto',
          borderRadius: `${radius.md}px`,
          '& .docx-wrapper': { background: 'transparent', p: { xs: 1, sm: 3 } },
          '& .docx-wrapper > section.docx': { boxShadow: '0 1px 3px rgb(0 0 0 / 0.3)', mb: 3, maxWidth: '100%' },
        }}
      />
    </Box>
  );
}
