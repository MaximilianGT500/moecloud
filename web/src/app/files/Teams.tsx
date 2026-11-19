import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import FolderSharedRounded from '@mui/icons-material/FolderSharedRounded';
import GroupAddRounded from '@mui/icons-material/GroupAddRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import RestoreFromTrashRounded from '@mui/icons-material/RestoreFromTrashRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, folderColor, mix, radius } from '../../theme/tokens';
import { EmptyState, StorageMeter } from '../common/bits';
import { confirm } from '../common/dialogs';
import { teamCounts, TeamMembersDialog, teamRoleLabel, TeamTrashDialog, type Team } from '../common/teams';
import { toast } from '../common/toast';

export function useTeams() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const load = () =>
    api
      .get<{ items: Team[] }>('/api/teams')
      .then((result) => setTeams(result.items))
      .catch((error) => {
        setTeams((current) => current ?? []);
        toast(errorText(error));
      });
  useEffect(() => {
    void load();
  }, []);
  useLive((event, data) => {
    if (event === 'reconnect' || (event === 'change' && data.teams)) void load();
  });
  return { teams, reload: load };
}

export function TeamsView() {
  const { teams, reload } = useTeams();
  const [members, setMembers] = useState<number | null>(null);
  const [trash, setTrash] = useState<Team | null>(null);
  const user = boot().user;

  const leave = async (team: Team) => {
    const ok = await confirm({
      title: t('„{name}“ verlassen?', { name: team.name }),
      text: t('Du siehst den Teamordner danach nicht mehr. Die Dateien darin bleiben für die anderen erhalten.'),
      confirm: t('Verlassen'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.post(`/api/teams/${team.id}/leave`);
      toast(t('Du hast „{name}“ verlassen', { name: team.name }));
      void reload();
    } catch (error) {
      toast(errorText(error));
    }
  };

  if (!teams) return null;
  if (teams.length === 0) {
    return (
      <EmptyState
        icon={<FolderSharedRounded />}
        title={t('Noch kein Teamordner')}
        text={
          user?.role === 'admin'
            ? t('Teamordner gehören keiner einzelnen Person und haben eigenen Speicher. Du legst sie in der Verwaltung an.')
            : t('Teamordner gehören keiner einzelnen Person. Die Verwaltung legt sie an und nimmt dich auf.')
        }
        action={
          user?.role === 'admin' ? (
            <Button variant="tonal" href="/admin/teams">
              {t('Zur Verwaltung')}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, pb: 4 }}>
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gap: 2,
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))',
        }}
      >
        {teams.map((team) => (
          <Box
            component="li"
            key={team.id}
            sx={{
              bgcolor: c.surfaceContainerLow,
              borderRadius: `${radius.lg}px`,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <ButtonBase
              component="a"
              href={`/files/folder/${team.rootId}`}
              nativeButton={false}
              onClick={(event: React.MouseEvent) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                navigate(`/files/folder/${team.rootId}`);
              }}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 1.5,
                p: 2.5,
                textAlign: 'left',
                flex: 1,
                '&:hover': { bgcolor: mix(c.onSurface, 5) },
                '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: -2 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <FolderSharedRounded sx={{ fontSize: 36, color: team.color ? folderColor(team.color) : c.primary, flex: 'none' }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, overflowWrap: 'anywhere', lineHeight: 1.25 }}>
                    {team.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {teamCounts(team)}
                  </Typography>
                </Box>
                <Chip size="small" label={teamRoleLabel(team.role)} variant={team.role === 'view' ? 'outlined' : 'filled'} />
              </Box>
              {team.description && (
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere', textWrap: 'pretty' }}>
                  {team.description}
                </Typography>
              )}
              <Box sx={{ mt: 'auto' }}>
                <StorageMeter storage={{ used: team.used, quota: team.quota }} compact />
              </Box>
            </ButtonBase>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1, pb: 1, minHeight: 44 }}>
              {team.canManage && (
                <>
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
                </>
              )}
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t('Teamordner verlassen')}>
                <IconButton aria-label={t('{name} verlassen', { name: team.name })} onClick={() => void leave(team)}>
                  <LogoutRounded />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        ))}
      </Box>
      <TeamMembersDialog teamId={members} admin={user?.role === 'admin'} onClose={() => setMembers(null)} onChanged={() => void reload()} />
      <TeamTrashDialog team={trash} onClose={() => setTrash(null)} onChanged={() => void reload()} />
    </Box>
  );
}

export function TeamBar({ info }: { info: { id: number; name: string; role: Team['role']; canManage: boolean } }) {
  const [members, setMembers] = useState<number | null>(null);
  const [trash, setTrash] = useState<Team | null>(null);
  const user = boot().user;

  const openTrash = () =>
    api
      .get<{ team: Team }>(`/api/teams/${info.id}`)
      .then((result) => setTrash(result.team))
      .catch((error) => toast(errorText(error)));

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: { xs: 1.5, md: 3 }, pb: 1, flexWrap: 'wrap' }}>
      <Chip
        size="small"
        icon={<FolderSharedRounded />}
        label={t('Teamordner · {role}', { role: teamRoleLabel(info.role) })}
        variant="outlined"
        onClick={() => navigate('/files/teams')}
      />
      {info.canManage && (
        <>
          <Button size="small" startIcon={<GroupAddRounded />} onClick={() => setMembers(info.id)}>
            {t('Mitglieder')}
          </Button>
          <Button size="small" startIcon={<RestoreFromTrashRounded />} onClick={() => void openTrash()}>
            {t('Papierkorb')}
          </Button>
        </>
      )}
      <TeamMembersDialog teamId={members} admin={user?.role === 'admin'} onClose={() => setMembers(null)} />
      <TeamTrashDialog team={trash} onClose={() => setTrash(null)} />
    </Box>
  );
}
