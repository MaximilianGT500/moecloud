import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import AddCommentRounded from '@mui/icons-material/AddCommentRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import CreateNewFolderRounded from '@mui/icons-material/CreateNewFolderRounded';
import DeleteForeverRounded from '@mui/icons-material/DeleteForeverRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DriveFileMoveRounded from '@mui/icons-material/DriveFileMoveRounded';
import DriveFileRenameOutlineRounded from '@mui/icons-material/DriveFileRenameOutlineRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import NoteAddRounded from '@mui/icons-material/NoteAddRounded';
import PaletteRounded from '@mui/icons-material/PaletteRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import PersonRemoveRounded from '@mui/icons-material/PersonRemoveRounded';
import GroupAddRounded from '@mui/icons-material/GroupAddRounded';
import GroupRemoveRounded from '@mui/icons-material/GroupRemoveRounded';
import UnarchiveRounded from '@mui/icons-material/UnarchiveRounded';
import RotateRightRounded from '@mui/icons-material/RotateRightRounded';
import RestoreFromTrashRounded from '@mui/icons-material/RestoreFromTrashRounded';
import type { SvgIconComponent } from '@mui/icons-material';
import { formatDateTime, formatDayLabel, formatRelative, formatTime } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';

export type ActivityAction =
  | 'upload'
  | 'link_upload'
  | 'folder'
  | 'text'
  | 'edit'
  | 'rename'
  | 'move'
  | 'copy'
  | 'trash'
  | 'restore'
  | 'delete'
  | 'version_restore'
  | 'share_user'
  | 'unshare_user'
  | 'share_group'
  | 'unshare_group'
  | 'extract'
  | 'rotate'
  | 'share_link'
  | 'comment'
  | 'color';

export interface ActivityEntry {
  id: number;
  action: ActivityAction;
  name: string;
  count: number;
  nodeId: string | null;
  parentId: string | null;
  actor: { id: number; name: string; initials: string } | null;
  self: boolean;
  viaLink: boolean;
  details: Record<string, unknown> | null;
  createdAt: number;
}

const ICONS: Record<ActivityAction, SvgIconComponent> = {
  upload: CloudUploadRounded,
  link_upload: LinkRounded,
  folder: CreateNewFolderRounded,
  text: NoteAddRounded,
  edit: EditNoteRounded,
  rename: DriveFileRenameOutlineRounded,
  move: DriveFileMoveRounded,
  copy: ContentCopyRounded,
  trash: DeleteOutlineRounded,
  restore: RestoreFromTrashRounded,
  delete: DeleteForeverRounded,
  version_restore: HistoryRounded,
  share_user: PersonAddAlt1Rounded,
  unshare_user: PersonRemoveRounded,
  share_group: GroupAddRounded,
  unshare_group: GroupRemoveRounded,
  extract: UnarchiveRounded,
  rotate: RotateRightRounded,
  share_link: LinkRounded,
  comment: AddCommentRounded,
  color: PaletteRounded,
};

function own(entry: ActivityEntry, p: Record<string, string>) {
  const n = entry.count;
  switch (entry.action) {
    case 'upload':
      return tn(n, 'Du hast {name} hochgeladen', 'Du hast {count} Dateien hochgeladen', p);
    case 'folder':
      return t('Du hast den Ordner {name} erstellt', p);
    case 'text':
      return t('Du hast {name} erstellt', p);
    case 'edit':
      return t('Du hast {name} bearbeitet', p);
    case 'rename':
      return t('Du hast {from} in {name} umbenannt', p);
    case 'move':
      return tn(n, 'Du hast {name} nach {to} verschoben', 'Du hast {count} Elemente nach {to} verschoben', p);
    case 'copy':
      return tn(n, 'Du hast {name} kopiert', 'Du hast {count} Elemente kopiert', p);
    case 'trash':
      return tn(n, 'Du hast {name} in den Papierkorb gelegt', 'Du hast {count} Elemente in den Papierkorb gelegt', p);
    case 'restore':
      return tn(n, 'Du hast {name} wiederhergestellt', 'Du hast {count} Elemente wiederhergestellt', p);
    case 'delete':
      return t('Du hast {name} endgültig gelöscht', p);
    case 'version_restore':
      return t('Du hast eine ältere Version von {name} zurückgeholt', p);
    case 'share_user':
      return t('Du hast {name} mit {with} geteilt', p);
    case 'unshare_user':
      return t('Du teilst {name} nicht mehr mit {with}', p);
    case 'share_group':
      return t('Du hast {name} mit der Gruppe {with} geteilt', p);
    case 'unshare_group':
      return t('Du teilst {name} nicht mehr mit der Gruppe {with}', p);
    case 'extract':
      return t('Du hast {name} entpackt', p);
    case 'rotate':
      return t('Du hast {name} gedreht', p);
    case 'share_link':
      return t('Du hast einen Link für {name} erstellt', p);
    case 'comment':
      return t('Du hast {name} kommentiert', p);
    case 'color':
      return t('Du hast die Farbe von {name} geändert', p);
    default:
      return entry.name;
  }
}

function other(entry: ActivityEntry, p: Record<string, string>) {
  const n = entry.count;
  switch (entry.action) {
    case 'upload':
      return tn(n, '{who} hat {name} hochgeladen', '{who} hat {count} Dateien hochgeladen', p);
    case 'folder':
      return t('{who} hat den Ordner {name} erstellt', p);
    case 'text':
      return t('{who} hat {name} erstellt', p);
    case 'edit':
      return t('{who} hat {name} bearbeitet', p);
    case 'rename':
      return t('{who} hat {from} in {name} umbenannt', p);
    case 'move':
      return tn(n, '{who} hat {name} nach {to} verschoben', '{who} hat {count} Elemente nach {to} verschoben', p);
    case 'copy':
      return tn(n, '{who} hat {name} kopiert', '{who} hat {count} Elemente kopiert', p);
    case 'trash':
      return tn(n, '{who} hat {name} in den Papierkorb gelegt', '{who} hat {count} Elemente in den Papierkorb gelegt', p);
    case 'restore':
      return tn(n, '{who} hat {name} wiederhergestellt', '{who} hat {count} Elemente wiederhergestellt', p);
    case 'delete':
      return t('{who} hat {name} endgültig gelöscht', p);
    case 'version_restore':
      return t('{who} hat eine ältere Version von {name} zurückgeholt', p);
    case 'share_user':
      return t('{who} hat {name} mit {with} geteilt', p);
    case 'unshare_user':
      return t('{who} teilt {name} nicht mehr mit {with}', p);
    case 'share_group':
      return t('{who} hat {name} mit der Gruppe {with} geteilt', p);
    case 'unshare_group':
      return t('{who} teilt {name} nicht mehr mit der Gruppe {with}', p);
    case 'extract':
      return t('{who} hat {name} entpackt', p);
    case 'rotate':
      return t('{who} hat {name} gedreht', p);
    case 'share_link':
      return t('{who} hat einen Link für {name} erstellt', p);
    case 'comment':
      return t('{who} hat {name} kommentiert', p);
    case 'color':
      return t('{who} hat die Farbe von {name} geändert', p);
    default:
      return entry.name;
  }
}

export function activityText(entry: ActivityEntry) {
  const p = {
    name: entry.name,
    who: entry.actor?.name ?? t('Jemand'),
    from: String(entry.details?.from ?? ''),
    to: String(entry.details?.to ?? ''),
    with: String(entry.details?.with ?? ''),
  };
  if (entry.action === 'link_upload' || (entry.viaLink && entry.action === 'upload')) {
    return tn(entry.count, '{name} kam über einen Link an', '{count} Dateien kamen über einen Link an', p);
  }
  return entry.self ? own(entry, p) : other(entry, p);
}

const dayKey = (time: number) => new Date(time).toDateString();

export function ActivityList({
  entries,
  onOpen,
  grouped = false,
}: {
  entries: ActivityEntry[];
  onOpen?: (entry: ActivityEntry) => void;
  grouped?: boolean;
}) {
  let lastDay = '';
  return (
    <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {entries.map((entry) => {
        const Icon = ICONS[entry.action] ?? HistoryRounded;
        const day = dayKey(entry.createdAt);
        const header = grouped && day !== lastDay;
        lastDay = day;
        const openable = Boolean(onOpen && (entry.parentId || entry.nodeId) && entry.action !== 'delete');
        const body = (
          <>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: `${radius.full}px`,
                display: 'grid',
                placeItems: 'center',
                flex: 'none',
                bgcolor: entry.action === 'delete' || entry.action === 'trash' ? mix(c.error, 14) : mix(c.primary, 14),
                color: entry.action === 'delete' || entry.action === 'trash' ? c.error : c.primary,
              }}
            >
              <Icon sx={{ fontSize: 20 }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                {activityText(entry)}
              </Typography>
              <Typography
                variant="caption"
                component="time"
                dateTime={new Date(entry.createdAt).toISOString()}
                title={formatDateTime(entry.createdAt)}
                sx={{ color: c.onSurfaceVariant }}
              >
                {grouped ? formatTime(entry.createdAt) : formatRelative(entry.createdAt)}
              </Typography>
            </Box>
          </>
        );
        return (
          <Box component="li" key={entry.id}>
            {header && (
              <Typography
                variant="overline"
                component="h3"
                sx={{ display: 'block', color: c.onSurfaceVariant, px: 1, pt: 2, pb: 0.5, lineHeight: 1.6 }}
              >
                {formatDayLabel(entry.createdAt)}
              </Typography>
            )}
            {openable ? (
              <ButtonBase
                onClick={() => onOpen?.(entry)}
                sx={{
                  width: '100%',
                  display: 'flex',
                  gap: 1.5,
                  alignItems: 'center',
                  textAlign: 'left',
                  p: 1,
                  borderRadius: `${radius.tile}px`,
                  '&:hover': { bgcolor: c.surfaceContainer },
                }}
              >
                {body}
              </ButtonBase>
            ) : (
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', p: 1 }}>{body}</Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
