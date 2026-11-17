import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import PaletteRounded from '@mui/icons-material/PaletteRounded';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import type { Palette } from '../../theme/scheme';
import { c } from '../../theme/tokens';
import {
  specOf,
  styleLabel,
  ThemeEditorDialog,
  ThemeGallery,
  type ThemeDraft,
  type ThemeList,
  type ThemeResult,
  type ThemeTile,
} from '../common/themes';
import { toast } from '../common/toast';
import { useThemeControl } from '../mount';

export function ThemeChoice() {
  const control = useThemeControl();
  const [list, setList] = useState<ThemeList | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .get<ThemeList>('/api/themes')
      .then(setList)
      .catch((error: unknown) => toast(errorText(error)));
  }, []);

  if (!list) return null;
  if (!list.personal) {
    return (
      <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
        {t('Das Theme legt die Verwaltung für alle fest.')}
      </Typography>
    );
  }

  const choose = async (body: unknown) => {
    if (busy) return false;
    setBusy(true);
    try {
      const result = await api.put<ThemeResult>('/api/account/theme', body);
      setList(result);
      control.adopt(result.theme, result.palette, result.css);
      setBusy(false);
      return true;
    } catch (error) {
      toast(errorText(error));
      setBusy(false);
      return false;
    }
  };

  const followsSite = !list.choice && !list.own;
  const tiles: ThemeTile[] = [
    {
      key: 'site',
      label: t('Wie alle'),
      hint: list.site.name || t('Theme der Verwaltung'),
      selected: followsSite,
      spec: specOf(list.site),
      preview: list.site.preview,
      onSelect: () => {
        if (!followsSite) void choose({ id: null });
      },
    },
    ...list.themes.map((theme): ThemeTile => ({
      key: theme.id,
      label: theme.name,
      hint: theme.source === 'custom' ? t('Eigenes Theme') : styleLabel(theme.style).name,
      selected: list.choice === theme.id,
      spec: specOf(theme),
      preview: theme.preview,
      onSelect: () => {
        if (list.choice !== theme.id) void choose({ id: theme.id });
      },
    })),
    {
      key: 'own',
      label: t('Eigene Farbe'),
      hint: list.own ? list.own.seed : t('Selbst zusammenstellen'),
      selected: Boolean(list.own),
      spec: list.own ?? control.spec,
      icon: list.own ? undefined : <PaletteRounded />,
      onSelect: () => setEditing(true),
    },
  ];

  const initial: ThemeDraft = { ...(list.own ?? control.spec), name: '', css: '' };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant="subtitle2">{t('Theme')}</Typography>
      <ThemeGallery label={t('Theme')} tiles={tiles} />
      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
        {t('Dein Theme gilt für dein Konto auf allen Geräten.')}
      </Typography>
      {editing && (
        <ThemeEditorDialog
          title={t('Eigene Farbe')}
          initial={initial}
          onClose={() => setEditing(false)}
          onSave={(draft: ThemeDraft, palette: Palette) => choose({ own: specOf(draft), palette })}
        />
      )}
    </Box>
  );
}
