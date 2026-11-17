import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { api, errorText } from '../../lib/api';
import { t } from '../../lib/i18n';
import { normalizeHex, THEME_FONTS, THEME_STYLES, type Palette, type ThemeSpec } from '../../theme/scheme';
import { c } from '../../theme/tokens';
import { Section } from '../common/bits';
import { confirm } from '../common/dialogs';
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
import { Loading, Toggle } from './shared';

interface StoredTheme extends ThemeSpec {
  id: string;
  name: string;
  css: string;
}

interface PluginTheme extends Partial<ThemeSpec> {
  name: string;
  seed: string;
  plugin: string;
}

type Saved = ThemeResult & { id?: string; items: StoredTheme[] };

function readTheme(text: string): ThemeDraft | null {
  try {
    const data = JSON.parse(text) as Partial<ThemeDraft> & { moecloudTheme?: number };
    const seed = normalizeHex(data.seed);
    if (data.moecloudTheme !== 1 || !seed) return null;
    return {
      name: String(data.name ?? '').slice(0, 40),
      seed,
      style: THEME_STYLES.find((style) => style === data.style) ?? 'content',
      secondary: normalizeHex(data.secondary),
      tertiary: normalizeHex(data.tertiary),
      font: THEME_FONTS.find((font) => font === data.font) ?? 'rounded',
      corners: data.corners === 0.5 || data.corners === 0.1 ? data.corners : 1,
      css: typeof data.css === 'string' ? data.css.slice(0, 20000) : '',
    };
  } catch {
    return null;
  }
}

export function AppearanceSection({ personal, onPersonal }: { personal: boolean; onPersonal: (value: boolean) => void }) {
  const control = useThemeControl();
  const [list, setList] = useState<ThemeList | null>(null);
  const [stored, setStored] = useState<StoredTheme[]>([]);
  const [offered, setOffered] = useState<PluginTheme[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; draft: ThemeDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void Promise.all([api.get<ThemeList>('/api/themes'), api.get<{ items: StoredTheme[] }>('/api/admin/themes')])
      .then(([themes, custom]) => {
        setList(themes);
        setStored(custom.items);
      })
      .catch((error: unknown) => toast(errorText(error)));
    void api
      .get<{ themes: PluginTheme[] }>('/api/admin/plugins')
      .then((result) => setOffered(result.themes))
      .catch(() => undefined);
  }, []);

  if (!list) {
    return (
      <Section title={t('Aussehen')}>
        <Loading />
      </Section>
    );
  }

  const adopt = (result: Saved) => {
    setList(result);
    if (result.items) setStored(result.items);
    control.adopt(result.theme, result.palette, result.css);
  };

  const choose = async (id: string, name: string) => {
    if (busy || list.site.id === id) return;
    setBusy(true);
    try {
      const result = await api.put<Saved>('/api/admin/site-theme', { id });
      adopt(result);
      toast(
        result.theme.personal
          ? t('„{name}“ gilt jetzt für alle. Du selbst siehst weiter dein eigenes Theme.', { name })
          : t('„{name}“ gilt jetzt für alle', { name })
      );
    } catch (error) {
      toast(errorText(error));
    }
    setBusy(false);
  };

  const save = async (draft: ThemeDraft, palette: Palette) => {
    try {
      const body = { ...draft, palette };
      const result = editing?.id
        ? await api.put<Saved>(`/api/admin/themes/${editing.id}`, body)
        : await api.post<Saved>('/api/admin/themes', body);
      adopt(result);
      toast(t('Theme gespeichert'));
      return true;
    } catch (error) {
      toast(errorText(error));
      return false;
    }
  };

  const remove = async (id: string, name: string) => {
    const sure = await confirm({
      title: t('„{name}“ löschen?', { name }),
      text: t('Wer das Theme gewählt hat, sieht danach wieder das Theme für alle.'),
      confirm: t('Löschen'),
      danger: true,
    });
    if (!sure) return;
    try {
      adopt(await api.delete<Saved>(`/api/admin/themes/${id}`));
      toast(t('Theme gelöscht'));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const load = async (picked: File | undefined) => {
    if (!picked) return;
    const draft = picked.size <= 200_000 ? readTheme(await picked.text()) : null;
    if (!draft) {
      toast(t('Das ist keine Theme-Datei von MoeCloud'));
      return;
    }
    setEditing({ id: null, draft });
  };

  const tiles: ThemeTile[] = list.themes.map((theme) => {
    const custom = stored.find((entry) => entry.id === theme.id);
    return {
      key: theme.id,
      label: theme.name,
      hint: theme.source === 'custom' ? t('Eigenes Theme') : styleLabel(theme.style).name,
      selected: list.site.id === theme.id,
      spec: specOf(theme),
      preview: theme.preview,
      onSelect: () => void choose(theme.id, theme.name),
      menu: custom
        ? {
            onEdit: () => setEditing({ id: custom.id, draft: { ...specOf(custom), name: custom.name, css: custom.css } }),
            onExport: () => {
              window.location.href = `/api/admin/themes/${custom.id}/export`;
            },
            onDelete: () => void remove(custom.id, custom.name),
          }
        : undefined,
    };
  });
  if (list.site.source === 'site') {
    tiles.unshift({
      key: 'site',
      label: t('Eigene Farbe'),
      hint: list.site.seed,
      selected: true,
      spec: specOf(list.site),
      preview: list.site.preview,
      onSelect: () => undefined,
    });
  }

  return (
    <Section
      title={t('Aussehen')}
      description={t('Wähl das Theme für alle. Ein Theme legt Farben, Schrift und Ecken fest, die Vorschau siehst du sofort.')}
    >
      <ThemeGallery label={t('Theme für alle')} tiles={tiles} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Button
          variant="outlined"
          startIcon={<AddRounded />}
          onClick={() => setEditing({ id: null, draft: { ...control.spec, name: '', css: '' } })}
        >
          {t('Neues Theme')}
        </Button>
        <Button variant="text" startIcon={<UploadFileRounded />} onClick={() => file.current?.click()}>
          {t('Theme aus Datei laden')}
        </Button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            void load(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </Box>
      {offered.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="subtitle2" component="h3">
            {t('Themes aus Plugins')}
          </Typography>
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {t('Ein Klick öffnet das Theme zum Anpassen. Erst mit Speichern kommt es in die Liste oben.')}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {offered.map((theme) => (
              <Chip
                key={`${theme.plugin}/${theme.name}`}
                variant="outlined"
                icon={
                  <Box component="span" sx={{ width: 16, height: 16, borderRadius: '50%', bgcolor: theme.seed, ml: '6px !important' }} />
                }
                label={t('{name} aus {plugin}', { name: theme.name, plugin: theme.plugin })}
                onClick={() => {
                  const draft = readTheme(JSON.stringify({ ...theme, moecloudTheme: 1 }));
                  if (draft) setEditing({ id: null, draft });
                }}
              />
            ))}
          </Box>
        </Box>
      )}
      <Toggle
        checked={personal}
        onChange={onPersonal}
        label={t('Eigenes Theme pro Person erlauben')}
        hint={t('Unter Konto wählt jede Person ein Theme aus dieser Liste oder stellt sich eine eigene Farbe zusammen.')}
      />
      {editing && (
        <ThemeEditorDialog
          title={editing.id ? t('Theme bearbeiten') : t('Neues Theme')}
          initial={editing.draft}
          admin
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </Section>
  );
}
