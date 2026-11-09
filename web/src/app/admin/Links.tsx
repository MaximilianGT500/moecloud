import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded';
import LinkOffRounded from '@mui/icons-material/LinkOffRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { api, errorText } from '../../lib/api';
import { formatDate, formatDay, formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { Section } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { Loading } from './shared';

interface AdminLink {
  id: string;
  url: string;
  label: string | null;
  hasPassword: boolean;
  expiresAt: number | null;
  expired: boolean;
  paused?: boolean;
  exhausted?: boolean;
  allowDownload: boolean;
  allowUpload: boolean;
  uploadOnly: boolean;
  views: number;
  downloads: number;
  createdAt: number;
  lastAccessAt: number | null;
  node: { id: string; name: string; type: 'file' | 'folder'; trashed: boolean } | null;
  owner: { id: number; name: string; username: string } | null;
  creator: { id: number; name: string } | null;
}

export function LinksSection() {
  const [links, setLinks] = useState<AdminLink[] | null>(null);
  const [filter, setFilter] = useState('');

  const load = () =>
    api
      .get<{ items: AdminLink[] }>('/api/admin/links')
      .then((result) => setLinks(result.items))
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  const remove = async (link: AdminLink) => {
    const ok = await confirm({
      title: t('Link entfernen?'),
      text: t('Wer den Link hat, kommt danach nicht mehr an „{name}“. Die Datei selbst bleibt.', { name: link.node?.name ?? '' }),
      confirm: t('Entfernen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/admin/links/${link.id}`);
      setLinks((current) => current?.filter((entry) => entry.id !== link.id) ?? null);
      toast(t('Link entfernt'));
    } catch (error) {
      toast(errorText(error));
    }
  };

  const query = filter.trim().toLowerCase();
  const shown = (links ?? []).filter(
    (link) =>
      !query ||
      [link.label, link.node?.name, link.owner?.name, link.owner?.username].some((value) => (value ?? '').toLowerCase().includes(query))
  );
  const active = (links ?? []).filter((link) => !link.expired && !link.paused && !link.exhausted).length;

  return (
    <Section
      title={t('Öffentliche Links')}
      description={
        links ? `${tn(links.length, '{count} Link', '{count} Links')} · ${tn(active, '{count} gültig', '{count} gültig')}` : undefined
      }
    >
      {!links ? (
        <Loading />
      ) : links.length === 0 ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: c.onSurfaceVariant }}>
          <LinkOffRounded />
          <Typography variant="body2">{t('Noch hat niemand einen Link erstellt.')}</Typography>
        </Box>
      ) : (
        <>
          <TextField
            size="small"
            placeholder={t('Nach Datei, Bezeichnung oder Person suchen')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            slotProps={{
              htmlInput: { 'aria-label': t('Links durchsuchen') },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ maxWidth: 420 }}
          />
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column' }}>
            {shown.map((link) => (
              <Box
                component="li"
                key={link.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  py: 1.25,
                  borderBottom: `1px solid ${c.outlineVariant}`,
                  '&:last-of-type': { borderBottom: 0 },
                }}
              >
                {link.node?.type === 'folder' ? (
                  <FolderRounded sx={{ color: c.primary }} />
                ) : (
                  <InsertDriveFileRounded sx={{ color: c.onSurfaceVariant }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {link.label || link.node?.name || t('Gelöscht')}
                    </Typography>
                    {link.expired && <Chip size="small" label={t('Abgelaufen')} />}
                    {link.paused && <Chip size="small" label={t('Pausiert')} />}
                    {link.exhausted && <Chip size="small" label={t('Alle Downloads genutzt')} />}
                    {link.node?.trashed && <Chip size="small" label={t('Im Papierkorb')} />}
                    {link.hasPassword && <Chip size="small" variant="outlined" label={t('Passwort')} />}
                    {(link.allowUpload || link.uploadOnly) && (
                      <Chip size="small" variant="outlined" label={link.uploadOnly ? t('Nur hochladen') : t('Hochladen')} />
                    )}
                  </Box>
                  <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant }}>
                    {[
                      link.label && link.node ? link.node.name : null,
                      link.owner ? t('von {name}', { name: link.owner.name }) : null,
                      t('erstellt {date}', { date: formatDate(link.createdAt) }),
                      link.expiresAt && !link.expired ? t('bis {date}', { date: formatDay(link.expiresAt) }) : null,
                      tn(link.views, '{count} Aufruf', '{count} Aufrufe'),
                      link.downloads ? tn(link.downloads, '{count} Download', '{count} Downloads') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                <Tooltip title={t('Öffnen')}>
                  <IconButton aria-label={t('Link öffnen')} href={link.url} target="_blank" rel="noopener noreferrer">
                    <OpenInNewRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Entfernen')}>
                  <IconButton aria-label={t('Link entfernen')} onClick={() => void remove(link)}>
                    <DeleteOutlineRounded />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
          {links.length >= 500 && (
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {t('Gezeigt werden die neuesten {count} Links.', { count: formatNumber(500) })}
            </Typography>
          )}
        </>
      )}
    </Section>
  );
}
