import { useEffect, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import AvatarGroup from '@mui/material/AvatarGroup';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import { api, errorText } from '../../lib/api';
import { t, tn } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { Section, UserAvatar } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import { Loading } from './shared';

interface Member {
  id: number;
  name: string;
  username: string;
  initials: string;
}

interface Group {
  id: number;
  name: string;
  createdAt: number;
  members: Member[];
  shares: number;
}

interface Person {
  id: number;
  name: string;
  username: string;
  initials?: string;
  disabled?: boolean;
}

interface Draft {
  id: number | null;
  name: string;
  members: Member[];
}

const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase();
};

export function GroupsSection() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [people, setPeople] = useState<Member[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<{ items: Group[] }>('/api/admin/groups')
      .then((result) => setGroups(result.items))
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
    api
      .get<{ items: Person[] }>('/api/admin/users')
      .then((result) =>
        setPeople(
          result.items
            .filter((person) => !person.disabled)
            .map((person) => ({ id: person.id, name: person.name, username: person.username, initials: initialsOf(person.name) }))
        )
      )
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const body = { name: draft.name, members: draft.members.map((member) => member.id) };
      if (draft.id) await api.patch(`/api/admin/groups/${draft.id}`, body);
      else await api.post('/api/admin/groups', body);
      toast(draft.id ? t('Gruppe gespeichert') : t('Gruppe „{name}“ angelegt', { name: draft.name.trim() }));
      setDraft(null);
      void load();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (group: Group) => {
    const ok = await confirm({
      title: t('Gruppe „{name}“ löschen?', { name: group.name }),
      text:
        group.shares > 0
          ? tn(
              group.shares,
              'Die Mitglieder verlieren den Zugriff auf eine Freigabe. Die Dateien selbst bleiben erhalten.',
              'Die Mitglieder verlieren den Zugriff auf {count} Freigaben. Die Dateien selbst bleiben erhalten.'
            )
          : t('Die Personen in der Gruppe bleiben erhalten.'),
      confirm: t('Löschen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/admin/groups/${group.id}`);
      toast(t('Gruppe gelöscht'));
      void load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Section
      title={t('Gruppen')}
      description={t(
        'Mit Gruppen teilst du Ordner mit mehreren Personen auf einmal. Wer neu in eine Gruppe kommt, sieht sofort alles, was mit ihr geteilt ist. Personen können nur mit Gruppen teilen, in denen sie selbst sind.'
      )}
      action={
        <Button variant="contained" startIcon={<AddRounded />} onClick={() => setDraft({ id: null, name: '', members: [] })}>
          {t('Gruppe anlegen')}
        </Button>
      }
    >
      {!groups ? (
        <Loading />
      ) : groups.length === 0 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Noch keine Gruppen. Leg zum Beispiel eine für deine Familie oder dein Team an.')}
        </Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {groups.map((group) => (
            <Box component="li" key={group.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
              <Avatar sx={{ bgcolor: c.tertiaryContainer, color: c.onTertiaryContainer }}>
                <GroupsRounded />
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {group.name}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {[
                    tn(group.members.length, '{count} Mitglied', '{count} Mitglieder'),
                    group.shares ? tn(group.shares, '{count} Freigabe', '{count} Freigaben') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
              <AvatarGroup
                max={5}
                sx={{ display: { xs: 'none', sm: 'flex' }, '& .MuiAvatar-root': { width: 30, height: 30, fontSize: '0.75rem' } }}
              >
                {group.members.map((member) => (
                  <Avatar key={member.id} alt={member.name} sx={{ bgcolor: c.primaryContainer, color: c.onPrimaryContainer }}>
                    {member.initials}
                  </Avatar>
                ))}
              </AvatarGroup>
              <Tooltip title={t('Bearbeiten')}>
                <IconButton
                  aria-label={t('Gruppe {name} bearbeiten', { name: group.name })}
                  onClick={() => setDraft({ id: group.id, name: group.name, members: group.members })}
                >
                  <EditRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('Löschen')}>
                <IconButton aria-label={t('Gruppe {name} löschen', { name: group.name })} onClick={() => void remove(group)}>
                  <DeleteOutlineRounded />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft?.id ? t('Gruppe bearbeiten') : t('Gruppe anlegen')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField
            label={t('Name')}
            placeholder={t('zum Beispiel Familie')}
            value={draft?.name ?? ''}
            autoFocus
            onChange={(event) => draft && setDraft({ ...draft, name: event.target.value })}
            slotProps={{ htmlInput: { maxLength: 60 } }}
          />
          <Autocomplete
            multiple
            options={people}
            value={draft?.members ?? []}
            onChange={(_event, value) => draft && setDraft({ ...draft, members: value })}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            filterSelectedOptions
            noOptionsText={t('Niemand gefunden')}
            renderOption={(props, option) => {
              const { key, ...rest } = props as typeof props & { key: string };
              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                  <UserAvatar initials={option.initials} size={32} />
                  <Box>
                    <Typography variant="body2">{option.name}</Typography>
                    <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                      @{option.username}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
            renderValue={(value, getItemProps) =>
              value.map((option, index) => {
                const { key, ...rest } = getItemProps({ index });
                return <Chip key={key} {...rest} label={option.name} />;
              })
            }
            renderInput={(params) => <TextField {...params} label={t('Mitglieder')} placeholder={t('Name oder Benutzername')} />}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('Abbrechen')}</Button>
          <Button variant="contained" disabled={busy || !draft?.name.trim()} onClick={() => void save()}>
            {draft?.id ? t('Speichern') : t('Anlegen')}
          </Button>
        </DialogActions>
      </Dialog>
    </Section>
  );
}
