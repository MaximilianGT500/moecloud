import { useEffect, useRef, useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import FolderSharedRounded from '@mui/icons-material/FolderSharedRounded';
import GroupAddRounded from '@mui/icons-material/GroupAddRounded';
import RestoreFromTrashRounded from '@mui/icons-material/RestoreFromTrashRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c, folderColor } from '../../theme/tokens';
import { Section } from '../common/bits';
import { prompt } from '../common/dialogs';
import { QuotaField } from '../common/QuotaField';
import { teamCounts, TeamMembersDialog, TeamTrashDialog, type Team } from '../common/teams';
import { toast } from '../common/toast';
import { Loading } from './shared';

interface Draft {
  id: number | null;
  name: string;
  description: string;
  quota: number | null;
}

export function TeamsSection() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [members, setMembers] = useState<number | null>(null);
  const [trash, setTrash] = useState<Team | null>(null);
  const [mail, setMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = useRef<number | null>(null);

  const load = () =>
    api
      .get<{ items: Team[] }>('/api/admin/teams')
      .then((result) => setTeams(result.items))
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
    api
      .get<{ mail: boolean }>('/api/admin/invites')
      .then((result) => setMail(result.mail))
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = { name: draft.name, description: draft.description || null, quota: draft.quota ?? 0 };
      if (draft.id) {
        await api.patch(`/api/teams/${draft.id}`, body);
        toast(t('Teamordner gespeichert'));
        setDraft(null);
      } else {
        const created = await api.post<{ team: Team }>('/api/admin/teams', body);
        toast(t('Teamordner „{name}“ angelegt', { name: created.team.name }));
        next.current = created.team.id;
        setDraft(null);
      }
      void load();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (team: Team) => {
    const typed = await prompt({
      title: t('Teamordner „{name}“ löschen?', { name: team.name }),
      text: t(
        'Damit verschwinden alle Dateien darin samt Versionen und Links, {size} insgesamt. Das lässt sich nicht rückgängig machen. Gib zur Bestätigung den Namen ein.',
        { size: formatBytes(team.used) }
      ),
      label: t('Name des Teamordners'),
      value: '',
      confirm: t('Endgültig löschen'),
    });
    if (typed === null) return;
    try {
      await api.delete(`/api/admin/teams/${team.id}?confirm=${encodeURIComponent(typed)}`);
      toast(t('Teamordner gelöscht'));
      void load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Section
      title={t('Teamordner')}
      description={t(
        'Ein Teamordner gehört keiner einzelnen Person. Er hat eigenen Speicher, und was darin liegt, bleibt auch dann, wenn jemand das Team verlässt. Mitglieder sehen ihn in der Navigation, in der Suche und als Ordner im WebDAV-Laufwerk.'
      )}
      action={
        <Button variant="contained" startIcon={<AddRounded />} onClick={() => setDraft({ id: null, name: '', description: '', quota: 0 })}>
          {t('Teamordner anlegen')}
        </Button>
      }
    >
      {!teams ? (
        <Loading />
      ) : teams.length === 0 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Noch kein Teamordner. Leg zum Beispiel einen für die Familie, den Verein oder ein Projekt an.')}
        </Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {teams.map((team) => {
            const percent = team.quota ? Math.min(100, (team.used / team.quota) * 100) : 0;
            return (
              <Box component="li" key={team.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.25, flexWrap: 'wrap' }}>
                <Avatar
                  sx={{
                    bgcolor: team.color ? folderColor(team.color) : c.primaryContainer,
                    color: team.color ? '#fff' : c.onPrimaryContainer,
                  }}
                >
                  <FolderSharedRounded />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {team.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant, display: 'block', overflowWrap: 'anywhere' }}>
                    {[
                      team.quota
                        ? t('{used} von {quota}', { used: formatBytes(team.used), quota: formatBytes(team.quota) })
                        : t('{used}, unbegrenzt', { used: formatBytes(team.used) }),
                      teamCounts(team),
                      team.description,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                  {team.quota ? (
                    <LinearProgress
                      variant="determinate"
                      value={percent}
                      aria-label={t('Speicher von {name}', { name: team.name })}
                      sx={{ mt: 0.75, maxWidth: 320, '& .MuiLinearProgress-bar': { bgcolor: percent > 90 ? c.error : c.primary } }}
                    />
                  ) : null}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Tooltip title={t('Mitglieder')}>
                    <IconButton aria-label={t('Mitglieder von {name}', { name: team.name })} onClick={() => setMembers(team.id)}>
                      <GroupAddRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={team.trash ? t('Papierkorb ({count})', { count: team.trash }) : t('Papierkorb')}>
                    <IconButton aria-label={t('Papierkorb von {name}', { name: team.name })} onClick={() => setTrash(team)}>
                      <RestoreFromTrashRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Bearbeiten')}>
                    <IconButton
                      aria-label={t('Teamordner {name} bearbeiten', { name: team.name })}
                      onClick={() =>
                        setDraft({ id: team.id, name: team.name, description: team.description ?? '', quota: team.quota ?? 0 })
                      }
                    >
                      <EditRounded />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('Löschen')}>
                    <IconButton aria-label={t('Teamordner {name} löschen', { name: team.name })} onClick={() => void remove(team)}>
                      <DeleteOutlineRounded />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        fullWidth
        maxWidth="sm"
        slotProps={{
          transition: {
            onExited: () => {
              if (next.current !== null) setMembers(next.current);
              next.current = null;
            },
          },
        }}
      >
        <DialogTitle>{draft?.id ? t('Teamordner bearbeiten') : t('Teamordner anlegen')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            label={t('Name')}
            placeholder={t('zum Beispiel Marketing')}
            value={draft?.name ?? ''}
            autoFocus
            onChange={(event) => draft && setDraft({ ...draft, name: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
          <TextField
            label={t('Beschreibung (freiwillig)')}
            value={draft?.description ?? ''}
            multiline
            minRows={2}
            onChange={(event) => draft && setDraft({ ...draft, description: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <QuotaField
            label={t('Speicher')}
            value={draft?.quota ?? 0}
            onChange={(quota) => draft && setDraft({ ...draft, quota })}
            helperText={t('Der Teamordner zählt nicht zum Speicher der Mitglieder.')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('Abbrechen')}</Button>
          <Button variant="contained" disabled={busy || !draft?.name.trim()} onClick={() => void save()}>
            {draft?.id ? t('Speichern') : t('Anlegen')}
          </Button>
        </DialogActions>
      </Dialog>
      <TeamMembersDialog teamId={members} admin mail={mail} onClose={() => setMembers(null)} onChanged={() => void load()} />
      <TeamTrashDialog team={trash} onClose={() => setTrash(null)} onChanged={() => void load()} />
    </Section>
  );
}
