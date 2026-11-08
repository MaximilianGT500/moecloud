import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import BackupRounded from '@mui/icons-material/BackupRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import StorageRounded from '@mui/icons-material/StorageRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, fonts } from '../../theme/tokens';
import { Section } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { Loading, Toggle } from './shared';

interface Backup {
  name: string;
  size: number;
  createdAt: number;
  kind: 'auto' | 'manual' | 'update';
}

interface BackupView {
  items: Backup[];
  settings: { 'backup.enabled': boolean; 'backup.hour': number; 'backup.keep': number };
  last: number | null;
  dir: string;
}

function kindLabel(kind: Backup['kind']) {
  if (kind === 'auto') return t('Automatisch');
  if (kind === 'update') return t('Vor Update');
  return t('Von Hand');
}

export function BackupsSection() {
  const [view, setView] = useState<BackupView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<BackupView>('/api/admin/backups')
      .then(setView)
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  if (!view) return <Loading />;

  const update = async (patch: Partial<BackupView['settings']>) => {
    try {
      await api.patch('/api/admin/settings', patch);
      setView({ ...view, settings: { ...view.settings, ...patch } });
    } catch (error) {
      toast(errorText(error));
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ item: Backup }>('/api/admin/backups');
      toast(t('Sicherung {name} erstellt', { name: result.item.name }));
      void load();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (backup: Backup) => {
    if (!(await confirm({ title: t('Sicherung löschen?'), text: backup.name, confirm: t('Löschen'), danger: true }))) return;
    try {
      await api.delete(`/api/admin/backups/${encodeURIComponent(backup.name)}`);
      void load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Section
        title={t('Sicherungen der Datenbank')}
        description={t(
          'Die Datenbank enthält Konten, Ordner, Freigaben, Links und Einstellungen. Vor jedem Update legt MoeCloud zusätzlich eine Sicherung an.'
        )}
        action={
          <Button variant="contained" startIcon={<BackupRounded />} disabled={busy} onClick={() => void create()}>
            {t('Jetzt sichern')}
          </Button>
        }
      >
        <Toggle
          checked={view.settings['backup.enabled']}
          onChange={(value) => void update({ 'backup.enabled': value })}
          label={t('Jeden Tag automatisch sichern')}
          hint={view.last ? t('Zuletzt am {date}', { date: formatDateTime(view.last) }) : undefined}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <TextField
            select
            label={t('Uhrzeit')}
            value={view.settings['backup.hour']}
            disabled={!view.settings['backup.enabled']}
            onChange={(event) => void update({ 'backup.hour': Number(event.target.value) })}
            helperText={t('Zeit des Servers')}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <MenuItem key={hour} value={hour}>
                {`${String(hour).padStart(2, '0')}:00`}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('Aufbewahren')}
            value={view.settings['backup.keep']}
            disabled={!view.settings['backup.enabled']}
            onChange={(event) => void update({ 'backup.keep': Number(event.target.value) })}
            helperText={t('Ältere automatische Sicherungen werden gelöscht.')}
          >
            {[3, 7, 14, 30, 60, 90].map((count) => (
              <MenuItem key={count} value={count}>
                {tn(count, 'die letzte {count}', 'die letzten {count}')}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <Alert severity="info" icon={<StorageRounded />}>
          {t(
            'Die Dateien selbst liegen im Ordner blobs neben der Datenbank. Sichere den ganzen Datenordner regelmäßig, zum Beispiel mit restic, Borg oder rsync.'
          )}
        </Alert>
      </Section>
      <Section
        title={t('Vorhandene Sicherungen')}
        description={
          <Box component="span" sx={{ fontFamily: fonts.mono, fontSize: '0.8125rem', overflowWrap: 'anywhere' }}>
            {view.dir}
          </Box>
        }
      >
        {view.items.length === 0 ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Noch keine Sicherung vorhanden.')}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {view.items.map((backup) => (
              <Box
                component="li"
                key={backup.name}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  py: 1,
                  borderBottom: `1px solid ${c.outlineVariant}`,
                  '&:last-of-type': { borderBottom: 0 },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatDateTime(backup.createdAt)}
                    </Typography>
                    <Chip size="small" label={kindLabel(backup.kind)} variant="outlined" />
                  </Box>
                  <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
                    {backup.name} · {formatBytes(backup.size)}
                  </Typography>
                </Box>
                <Tooltip title={t('Herunterladen')}>
                  <IconButton
                    aria-label={t('{name} herunterladen', { name: backup.name })}
                    href={`/api/admin/backups/${encodeURIComponent(backup.name)}`}
                    download
                  >
                    <DownloadRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Löschen')}>
                  <IconButton aria-label={t('{name} löschen', { name: backup.name })} onClick={() => void remove(backup)}>
                    <DeleteOutlineRounded />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
          {t(
            'Zum Wiederherstellen MoeCloud stoppen, die Sicherung als moecloud.db in den Datenordner legen, die Dateien moecloud.db-wal und moecloud.db-shm löschen und wieder starten.'
          )}
        </Typography>
      </Section>
    </Box>
  );
}
