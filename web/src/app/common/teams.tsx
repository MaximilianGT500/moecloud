import { useEffect, useRef, useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteForeverRounded from '@mui/icons-material/DeleteForeverRounded';
import FolderRounded from '@mui/icons-material/FolderRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import InsertDriveFileOutlined from '@mui/icons-material/InsertDriveFileOutlined';
import RestoreRounded from '@mui/icons-material/RestoreRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { UserAvatar } from './bits';
import { confirm } from './dialogs';
import { toast } from './toast';

export type TeamRole = 'view' | 'edit' | 'manage';

export interface TeamPerson {
  id: number;
  name: string;
  username: string;
  initials: string;
  avatar?: string | null;
  guest: boolean;
  role: TeamRole;
}

export interface TeamGroup {
  id: number;
  name: string;
  members: number;
  role: 'view' | 'edit';
}

export interface Team {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  rootId: string;
  role: TeamRole | null;
  canManage: boolean;
  used: number;
  quota: number | null;
  people: number;
  groups: number;
  trash?: number;
  createdAt: number;
  members?: { people: TeamPerson[]; groups: TeamGroup[] };
}

interface Candidate {
  kind: 'person' | 'group';
  id: number;
  name: string;
  detail: string;
  initials?: string;
  avatar?: string | null;
  guest?: boolean;
}

interface TrashItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  size: number;
  trashedAt?: number | null;
}

export function teamRoleLabel(role: TeamRole | null) {
  if (role === 'manage') return t('Leitung');
  if (role === 'edit') return t('Bearbeiten');
  if (role === 'view') return t('Lesen');
  return t('Kein Mitglied');
}

export function teamCounts(team: Pick<Team, 'people' | 'groups'>) {
  return [tn(team.people, '{count} Person', '{count} Personen'), team.groups ? tn(team.groups, '{count} Gruppe', '{count} Gruppen') : null]
    .filter(Boolean)
    .join(' · ');
}

function RoleSelect<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  label: string;
  onChange: (value: T) => void;
}) {
  return (
    <TextField
      select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      sx={{ width: 150, flex: 'none' }}
      slotProps={{ htmlInput: { 'aria-label': label } }}
    >
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function TeamMembersDialog({
  teamId,
  admin,
  mail,
  onClose,
  onChanged,
}: {
  teamId: number | null;
  admin: boolean;
  mail?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [team, setTeam] = useState<Team | null>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Candidate[]>([]);
  const [email, setEmail] = useState('');
  const [guest, setGuest] = useState(true);
  const [inviteRole, setInviteRole] = useState<'view' | 'edit'>('edit');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  useEffect(() => {
    setTeam(null);
    setQuery('');
    setEmail('');
    if (teamId === null) return;
    api
      .get<{ team: Team }>(`/api/teams/${teamId}`)
      .then((result) => setTeam(result.team))
      .catch((error) => {
        toast(errorText(error));
        onClose();
      });
  }, [teamId]);

  useEffect(() => {
    if (teamId === null) return;
    const current = ++request.current;
    const timer = setTimeout(() => {
      api
        .get<{
          people: { id: number; name: string; username: string; initials: string; avatar?: string | null; guest?: boolean }[];
          groups: { id: number; name: string; members: number }[];
        }>(`/api/teams/${teamId}/candidates?q=${encodeURIComponent(query)}`)
        .then((result) => {
          if (current !== request.current) return;
          setOptions([
            ...result.people.map((person) => ({
              kind: 'person' as const,
              id: person.id,
              name: person.name,
              detail: `@${person.username}`,
              initials: person.initials,
              avatar: person.avatar,
              guest: person.guest,
            })),
            ...result.groups.map((group) => ({
              kind: 'group' as const,
              id: group.id,
              name: group.name,
              detail: tn(group.members, '{count} Mitglied', '{count} Mitglieder'),
            })),
          ]);
        })
        .catch(() => setOptions([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [teamId, query, team?.people, team?.groups]);

  const apply = async (call: Promise<{ team: Team }>) => {
    try {
      setTeam((await call).team);
      onChanged?.();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const add = (candidate: Candidate) =>
    apply(
      candidate.kind === 'person'
        ? api.put(`/api/teams/${teamId}/people/${candidate.id}`, { role: 'edit' })
        : api.put(`/api/teams/${teamId}/groups/${candidate.id}`, { role: 'edit' })
    );

  const invite = async () => {
    if (!team) return;
    setBusy(true);
    try {
      await api.post('/api/admin/invites', {
        email: email.trim(),
        role: guest ? 'guest' : 'user',
        teamId: team.id,
        teamRole: inviteRole,
        days: 14,
      });
      toast(t('Einladung an {email} verschickt', { email: email.trim() }));
      setEmail('');
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const members = team?.members;
  return (
    <Dialog open={teamId !== null} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{team ? t('Mitglieder von „{name}“', { name: team.name }) : t('Mitglieder')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
        <Autocomplete
          options={options}
          value={null}
          inputValue={query}
          onInputChange={(_event, value, reason) => reason !== 'reset' && setQuery(value)}
          onChange={(_event, value) => {
            if (!value) return;
            setQuery('');
            void add(value);
          }}
          filterOptions={(list) => list}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(a, b) => a.kind === b.kind && a.id === b.id}
          groupBy={(option) => (option.kind === 'person' ? t('Personen') : t('Gruppen'))}
          noOptionsText={query.trim() ? t('Niemand gefunden') : t('Tipp einen Namen, um Personen zu finden')}
          blurOnSelect
          clearOnBlur={false}
          renderOption={(props, option) => {
            const { key, ...rest } = props as typeof props & { key: string };
            return (
              <Box component="li" key={`${option.kind}-${option.id}`} {...rest} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                {option.kind === 'person' ? (
                  <UserAvatar initials={option.initials ?? '?'} size={32} avatar={option.avatar} userId={option.id} />
                ) : (
                  <Avatar sx={{ width: 32, height: 32, bgcolor: c.tertiaryContainer, color: c.onTertiaryContainer }}>
                    <GroupsRounded fontSize="small" />
                  </Avatar>
                )}
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{option.name}</Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {option.guest ? `${option.detail} · ${t('Gast')}` : option.detail}
                  </Typography>
                </Box>
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField {...params} label={t('Person oder Gruppe hinzufügen')} placeholder={t('Name oder Benutzername')} />
          )}
        />
        {!members ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Lädt …')}
          </Typography>
        ) : members.people.length + members.groups.length === 0 ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Noch niemand. Füg oben Personen oder Gruppen hinzu.')}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {members.groups.map((group) => (
              <Box component="li" key={`g${group.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
                <Avatar sx={{ width: 36, height: 36, bgcolor: c.tertiaryContainer, color: c.onTertiaryContainer }}>
                  <GroupsRounded fontSize="small" />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {group.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {t('Gruppe')} · {tn(group.members, '{count} Mitglied', '{count} Mitglieder')}
                  </Typography>
                </Box>
                <RoleSelect
                  value={group.role}
                  label={t('Recht für {name}', { name: group.name })}
                  options={[
                    { value: 'view', label: t('Lesen') },
                    { value: 'edit', label: t('Bearbeiten') },
                  ]}
                  onChange={(role) => void apply(api.put(`/api/teams/${teamId}/groups/${group.id}`, { role }))}
                />
                <Tooltip title={t('Entfernen')}>
                  <IconButton
                    aria-label={t('{name} entfernen', { name: group.name })}
                    onClick={() => void apply(api.delete(`/api/teams/${teamId}/groups/${group.id}`))}
                  >
                    <CloseRounded />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
            {members.people.map((person) => (
              <Box component="li" key={`p${person.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
                <UserAvatar initials={person.initials} size={36} avatar={person.avatar} userId={person.id} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {person.name}
                    {person.guest && <Chip size="small" label={t('Gast')} sx={{ ml: 1, height: 20 }} />}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    @{person.username}
                  </Typography>
                </Box>
                <RoleSelect
                  value={person.role}
                  label={t('Recht für {name}', { name: person.name })}
                  options={[
                    { value: 'view', label: t('Lesen') },
                    { value: 'edit', label: t('Bearbeiten') },
                    { value: 'manage', label: t('Leitung'), disabled: person.guest },
                  ]}
                  onChange={(role) => void apply(api.put(`/api/teams/${teamId}/people/${person.id}`, { role }))}
                />
                <Tooltip title={t('Entfernen')}>
                  <IconButton
                    aria-label={t('{name} entfernen', { name: person.name })}
                    onClick={() => void apply(api.delete(`/api/teams/${teamId}/people/${person.id}`))}
                  >
                    <CloseRounded />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant, textWrap: 'pretty' }}>
          {t(
            'Lesen heißt ansehen und herunterladen. Bearbeiten heißt auch hochladen, ändern, löschen und per Link teilen. Die Leitung nimmt zusätzlich Personen auf und holt Gelöschtes aus dem Papierkorb zurück.'
          )}
        </Typography>
        {admin && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1, borderTop: `1px solid ${c.outlineVariant}` }}>
            <Typography variant="subtitle2" component="h3">
              {t('Jemanden von außen einladen')}
            </Typography>
            {mail === false ? (
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                {t('Dafür muss der E-Mail-Versand eingerichtet sein.')}
              </Typography>
            ) : (
              <>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <TextField
                    label={t('E-Mail-Adresse')}
                    type="email"
                    size="small"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    sx={{ flex: 1, minWidth: 220 }}
                  />
                  <RoleSelect
                    value={guest ? 'guest' : 'user'}
                    label={t('Art des Kontos')}
                    options={[
                      { value: 'guest', label: t('Gastkonto') },
                      { value: 'user', label: t('Volles Konto') },
                    ]}
                    onChange={(value) => setGuest(value === 'guest')}
                  />
                  <RoleSelect
                    value={inviteRole}
                    label={t('Recht im Teamordner')}
                    options={[
                      { value: 'view', label: t('Lesen') },
                      { value: 'edit', label: t('Bearbeiten') },
                    ]}
                    onChange={setInviteRole}
                  />
                </Box>
                <Box>
                  <Button
                    variant="tonal"
                    startIcon={<SendRounded />}
                    disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}
                    onClick={() => void invite()}
                  >
                    {t('Einladung schicken')}
                  </Button>
                </Box>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant, textWrap: 'pretty' }}>
                  {t(
                    'Die Person legt sich über den Link ein Konto an und landet direkt in diesem Teamordner. Ein Gastkonto hat keinen eigenen Speicher und sieht nur, was mit ihm geteilt ist.'
                  )}
                </Typography>
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('Fertig')}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function TeamTrashDialog({ team, onClose, onChanged }: { team: Team | null; onClose: () => void; onChanged?: () => void }) {
  const [items, setItems] = useState<TrashItem[] | null>(null);

  const load = (id: number) =>
    api
      .get<{ items: TrashItem[] }>(`/api/teams/${id}/trash`)
      .then((result) => setItems(result.items))
      .catch((error) => {
        toast(errorText(error));
        onClose();
      });

  useEffect(() => {
    setItems(null);
    if (team) void load(team.id);
  }, [team?.id]);

  if (!team) return null;

  const act = async (call: Promise<unknown>, message: string) => {
    try {
      await call;
      toast(message);
      await load(team.id);
      onChanged?.();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const destroy = async (item: TrashItem) => {
    const ok = await confirm({
      title: t('„{name}“ endgültig löschen?', { name: item.name }),
      text: t('Das lässt sich nicht rückgängig machen.'),
      confirm: t('Endgültig löschen'),
      danger: true,
    });
    if (ok) await act(api.post(`/api/teams/${team.id}/trash/delete`, { ids: [item.id] }), t('Endgültig gelöscht'));
  };

  const empty = async () => {
    const ok = await confirm({
      title: t('Papierkorb von „{name}“ leeren?', { name: team.name }),
      text: t('Alles darin wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.'),
      confirm: t('Leeren'),
      danger: true,
    });
    if (ok) await act(api.delete(`/api/teams/${team.id}/trash`), t('Papierkorb geleert'));
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('Papierkorb von „{name}“', { name: team.name })}</DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        {!items ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Lädt …')}
          </Typography>
        ) : items.length === 0 ? (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Der Papierkorb ist leer. Was Mitglieder in diesem Teamordner löschen, landet hier.')}
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {items.map((item) => (
              <Box component="li" key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}>
                <Box sx={{ color: c.onSurfaceVariant, display: 'flex' }}>
                  {item.type === 'folder' ? <FolderRounded /> : <InsertDriveFileOutlined />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {[
                      item.type === 'file' ? formatBytes(item.size) : t('Ordner'),
                      item.trashedAt ? t('gelöscht {when}', { when: formatRelative(item.trashedAt) }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>
                <Tooltip title={t('Wiederherstellen')}>
                  <IconButton
                    aria-label={t('{name} wiederherstellen', { name: item.name })}
                    onClick={() => void act(api.post(`/api/teams/${team.id}/trash/restore`, { ids: [item.id] }), t('Wiederhergestellt'))}
                  >
                    <RestoreRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('Endgültig löschen')}>
                  <IconButton aria-label={t('{name} endgültig löschen', { name: item.name })} onClick={() => void destroy(item)}>
                    <DeleteForeverRounded />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {items && items.length > 0 && (
          <Button color="error" onClick={() => void empty()} sx={{ mr: 'auto' }}>
            {t('Papierkorb leeren')}
          </Button>
        )}
        <Button onClick={onClose}>{t('Schließen')}</Button>
      </DialogActions>
    </Dialog>
  );
}
