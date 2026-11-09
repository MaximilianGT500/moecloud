import { useEffect, useState, type ReactElement } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AddLinkRounded from '@mui/icons-material/AddLinkRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import PauseCircleRounded from '@mui/icons-material/PauseCircleRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import PersonAddRounded from '@mui/icons-material/PersonAddRounded';
import PersonRemoveRounded from '@mui/icons-material/PersonRemoveRounded';
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import UploadRounded from '@mui/icons-material/UploadRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { formatDay, formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { CopyField, QrCode, UserAvatar, copyText } from '../common/bits';
import { confirm } from '../common/dialogs';
import { toast } from '../common/toast';
import type { Item } from './kinds';
import type { SharedGrant, SharedLink } from './model';

interface ShareSettings {
  links: boolean;
  users: boolean;
  requirePassword: boolean;
  maxDays: number;
}

interface Shares {
  role: 'owner' | 'edit' | 'view';
  canLink: boolean;
  canGrant: boolean;
  links: SharedLink[];
  grants: SharedGrant[];
}

interface Person {
  id: number;
  name: string;
  username: string;
  initials: string;
}

type Recipient = ({ kind: 'user' } & Person) | { kind: 'group'; id: number; name: string; members: number };

function GroupAvatar({ size }: { size: number }) {
  return (
    <Avatar
      sx={{ width: size, height: size, bgcolor: c.tertiaryContainer, color: c.onTertiaryContainer, '& svg': { fontSize: size * 0.55 } }}
    >
      <GroupsRounded />
    </Avatar>
  );
}

const settings = () =>
  (boot() as unknown as { share?: ShareSettings }).share ?? { links: true, users: true, requirePassword: false, maxDays: 0 };

const dayValue = (time: number | null) => {
  if (!time) return '';
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const endOfDay = (value: string) => (value ? new Date(`${value}T23:59:59`).getTime() : null);

function LinkForm({
  item,
  link,
  onSaved,
  onCancel,
}: {
  item: Item;
  link: SharedLink | null;
  onSaved: (link: SharedLink) => void;
  onCancel?: () => void;
}) {
  const rules = settings();
  const folder = item.type === 'folder';
  const [label, setLabel] = useState(link?.label ?? '');
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [expires, setExpires] = useState(dayValue(link?.expiresAt ?? (rules.maxDays ? Date.now() + rules.maxDays * 86_400_000 : null)));
  const [allowDownload, setAllowDownload] = useState(link?.allowDownload ?? true);
  const [allowUpload, setAllowUpload] = useState(link?.allowUpload ?? false);
  const [uploadOnly, setUploadOnly] = useState(link?.uploadOnly ?? false);
  const [notify, setNotify] = useState(link?.notify ?? true);
  const [maxDownloads, setMaxDownloads] = useState<number | null>(link?.maxDownloads ?? null);
  const [busy, setBusy] = useState(false);
  const today = dayValue(Date.now() + 86_400_000);
  const max = rules.maxDays ? dayValue(Date.now() + rules.maxDays * 86_400_000) : undefined;
  const needsPassword = rules.requirePassword && !password && (!link?.hasPassword || removePassword);

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        label: label.trim() || null,
        password: password || null,
        removePassword: Boolean(link?.hasPassword && removePassword && !password),
        expiresAt: endOfDay(expires),
        allowDownload,
        allowUpload: allowUpload || uploadOnly,
        uploadOnly,
        notify: (allowUpload || uploadOnly) && notify,
        maxDownloads: allowDownload && !uploadOnly ? maxDownloads : null,
      };
      const result = link
        ? await api.patch<{ link: SharedLink }>(`/api/links/${link.id}`, body)
        : await api.post<{ link: SharedLink }>(`/api/nodes/${item.id}/links`, body);
      onSaved(result.link);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}
    >
      <TextField
        label={t('Bezeichnung (freiwillig)')}
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        slotProps={{ htmlInput: { maxLength: 80 } }}
        helperText={t('Hilft dir, Links auseinanderzuhalten. Besucher sehen sie als Titel.')}
      />
      <TextField
        label={link?.hasPassword && !removePassword ? t('Neues Passwort') : t('Passwort')}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required={rules.requirePassword && !link?.hasPassword}
        helperText={
          link?.hasPassword && !removePassword
            ? t('Der Link hat ein Passwort. Lass das Feld leer, um es zu behalten.')
            : rules.requirePassword
              ? t('Auf diesem Server brauchen Links ein Passwort.')
              : t('Wer den Link öffnet, muss es eingeben.')
        }
      />
      {link?.hasPassword && !rules.requirePassword && (
        <FormControlLabel
          control={<Switch checked={removePassword} onChange={(event) => setRemovePassword(event.target.checked)} />}
          label={t('Passwort entfernen')}
        />
      )}
      <TextField
        label={t('Läuft ab am')}
        type="date"
        value={expires}
        onChange={(event) => setExpires(event.target.value)}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today, max } }}
        required={Boolean(rules.maxDays)}
        helperText={
          rules.maxDays
            ? tn(rules.maxDays, 'Links laufen hier nach höchstens {count} Tag ab.', 'Links laufen hier nach höchstens {count} Tagen ab.')
            : t('Leer lassen, damit der Link nicht abläuft.')
        }
      />
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        <FormControlLabel
          control={
            <Switch
              checked={allowDownload && !uploadOnly}
              disabled={uploadOnly}
              onChange={(event) => setAllowDownload(event.target.checked)}
            />
          }
          label={t('Herunterladen erlauben')}
        />
        {allowDownload && !uploadOnly && (
          <TextField
            select
            size="small"
            label={t('Downloads')}
            value={maxDownloads ?? 0}
            onChange={(event) => setMaxDownloads(Number(event.target.value) || null)}
            helperText={t('Danach funktioniert der Link nicht mehr. Ansehen zählt nicht als Download.')}
            sx={{ mt: 1.5, mb: 1, maxWidth: 360 }}
          >
            <MenuItem value={0}>{t('Unbegrenzt')}</MenuItem>
            {[1, 3, 5, 10, 25, 50, 100].map((count) => (
              <MenuItem key={count} value={count}>
                {tn(count, 'Höchstens {count} Download', 'Höchstens {count} Downloads')}
              </MenuItem>
            ))}
          </TextField>
        )}
        {folder && (
          <FormControlLabel
            control={
              <Switch
                checked={allowUpload || uploadOnly}
                disabled={uploadOnly}
                onChange={(event) => setAllowUpload(event.target.checked)}
              />
            }
            label={t('Hochladen erlauben')}
          />
        )}
        {folder && (
          <FormControlLabel
            control={<Switch checked={uploadOnly} onChange={(event) => setUploadOnly(event.target.checked)} />}
            label={t('Nur hochladen, Inhalt bleibt verborgen')}
          />
        )}
        {folder && (allowUpload || uploadOnly) && (
          <FormControlLabel
            control={<Switch checked={notify} onChange={(event) => setNotify(event.target.checked)} />}
            label={t('Benachrichtigen, wenn etwas ankommt')}
          />
        )}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        {onCancel && <Button onClick={onCancel}>{t('Abbrechen')}</Button>}
        <Button type="submit" variant="contained" disabled={busy || needsPassword}>
          {link ? t('Speichern') : t('Link erstellen')}
        </Button>
      </Box>
    </Box>
  );
}

function LinkCard({
  item,
  link,
  onChange,
  onDelete,
}: {
  item: Item;
  link: SharedLink;
  onChange: (link: SharedLink) => void;
  onDelete: () => void;
}) {
  const [edit, setEdit] = useState(false);
  const [qr, setQr] = useState(false);
  const chips = [
    link.hasPassword && { icon: <LockRounded />, label: t('Passwort') },
    link.expiresAt && {
      icon: <ScheduleRounded />,
      label: link.expired ? t('Abgelaufen') : t('Bis {date}', { date: formatDay(link.expiresAt) }),
    },
    link.uploadOnly
      ? { icon: <UploadRounded />, label: t('Nur hochladen') }
      : link.allowUpload && { icon: <UploadRounded />, label: t('Hochladen erlaubt') },
    !link.allowDownload && !link.uploadOnly && { icon: <VisibilityRounded />, label: t('Nur ansehen') },
    link.maxDownloads && {
      icon: <DownloadRounded />,
      label: link.exhausted
        ? t('Alle Downloads genutzt')
        : t('{count} von {max} Downloads', { count: formatNumber(link.downloads), max: formatNumber(link.maxDownloads) }),
    },
    link.paused && { icon: <PauseCircleRounded />, label: t('Pausiert') },
  ].filter(Boolean) as { icon: ReactElement; label: string }[];
  const togglePause = async () => {
    try {
      const result = await api.patch<{ link: SharedLink }>(`/api/links/${link.id}`, { paused: !link.paused });
      onChange(result.link);
      toast(result.link.paused ? t('Link pausiert') : t('Link wieder aktiv'));
    } catch (error) {
      toast(errorText(error));
    }
  };
  return (
    <Box sx={{ bgcolor: c.surfaceContainer, borderRadius: `${radius.md}px`, p: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {link.label && (
        <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LinkRounded fontSize="small" /> {link.label}
        </Typography>
      )}
      <CopyField value={link.url} label={t('Link')} />
      {chips.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {chips.map((chip) => (
            <Chip key={chip.label} size="small" icon={chip.icon} label={chip.label} variant="outlined" />
          ))}
        </Box>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: c.onSurfaceVariant, flex: 1, minWidth: 140 }}>
          {t('{views} Aufrufe · {downloads} Downloads', { views: formatNumber(link.views), downloads: formatNumber(link.downloads) })}
        </Typography>
        <Tooltip title={link.paused ? t('Fortsetzen') : t('Pausieren')}>
          <IconButton aria-label={link.paused ? t('Link fortsetzen') : t('Link pausieren')} onClick={() => void togglePause()}>
            {link.paused ? <PlayCircleRounded /> : <PauseCircleRounded />}
          </IconButton>
        </Tooltip>
        <Tooltip title={t('QR-Code')}>
          <IconButton aria-label={t('QR-Code')} aria-expanded={qr} onClick={() => setQr(!qr)}>
            <QrCode2Rounded />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Einstellungen')}>
          <IconButton aria-label={t('Einstellungen')} aria-expanded={edit} onClick={() => setEdit(!edit)}>
            <TuneRounded />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('Link löschen')}>
          <IconButton aria-label={t('Link löschen')} onClick={onDelete} sx={{ color: c.error }}>
            <DeleteOutlineRounded />
          </IconButton>
        </Tooltip>
      </Box>
      <Collapse in={qr} unmountOnExit>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
          <QrCode value={link.url} size={180} label={t('QR-Code für den Link')} />
        </Box>
      </Collapse>
      <Collapse in={edit} unmountOnExit>
        <LinkForm
          item={item}
          link={link}
          onSaved={(saved) => {
            onChange(saved);
            setEdit(false);
            toast(t('Link gespeichert'));
          }}
          onCancel={() => setEdit(false)}
        />
      </Collapse>
    </Box>
  );
}

function People({ item, grants, onChange }: { item: Item; grants: SharedGrant[]; onChange: (grants: SharedGrant[]) => void }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Recipient[]>([]);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [permission, setPermission] = useState<'view' | 'edit'>('view');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .get<{ items: Person[]; groups?: { id: number; name: string; members: number }[] }>(
          `/api/users/search?q=${encodeURIComponent(query.trim())}`,
          abort.signal
        )
        .then((result) =>
          setOptions([
            ...(result.groups ?? [])
              .filter((group) => !grants.some((grant) => grant.group?.id === group.id))
              .map((group) => ({ kind: 'group' as const, ...group })),
            ...result.items
              .filter((entry) => !grants.some((grant) => grant.user?.id === entry.id))
              .map((person) => ({ kind: 'user' as const, ...person })),
          ])
        )
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, grants]);

  const add = async () => {
    if (!recipient) return;
    try {
      const result = await api.post<{ grant: SharedGrant }>(`/api/nodes/${item.id}/grants`, {
        ...(recipient.kind === 'group' ? { groupId: recipient.id } : { userId: recipient.id }),
        permission,
      });
      onChange([...grants, result.grant]);
      setRecipient(null);
      setQuery('');
      toast(
        recipient.kind === 'group'
          ? t('Mit der Gruppe {name} geteilt', { name: recipient.name })
          : t('Mit {name} geteilt', { name: recipient.name })
      );
    } catch (error) {
      toast(errorText(error));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <Autocomplete
          sx={{ flex: 1, minWidth: 220 }}
          options={query.trim().length < 2 ? [] : options}
          value={recipient}
          onChange={(_event, value) => setRecipient(value)}
          inputValue={query}
          onInputChange={(_event, value) => setQuery(value)}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(a, b) => a.kind === b.kind && a.id === b.id}
          filterOptions={(list) => list}
          loading={loading}
          noOptionsText={query.trim().length < 2 ? t('Tipp mindestens 2 Zeichen') : t('Niemand gefunden')}
          loadingText={t('Sucht')}
          renderOption={(props, option) => {
            const { key, ...rest } = props as typeof props & { key: string };
            return (
              <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                {option.kind === 'group' ? <GroupAvatar size={32} /> : <UserAvatar initials={option.initials} size={32} />}
                <Box>
                  <Typography variant="body2">{option.name}</Typography>
                  <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                    {option.kind === 'group'
                      ? tn(option.members, 'Gruppe mit {count} Person', 'Gruppe mit {count} Personen')
                      : `@${option.username}`}
                  </Typography>
                </Box>
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField {...params} label={t('Person oder Gruppe')} placeholder={t('Name, Benutzername oder Gruppe')} />
          )}
        />
        <Select
          value={permission}
          onChange={(event) => setPermission(event.target.value as 'view' | 'edit')}
          aria-label={t('Recht')}
          sx={{ minWidth: 168 }}
        >
          <MenuItem value="view">{t('Kann ansehen')}</MenuItem>
          <MenuItem value="edit">{t('Kann bearbeiten')}</MenuItem>
        </Select>
        <Button variant="tonal" startIcon={<PersonAddRounded />} disabled={!recipient} onClick={() => void add()} sx={{ minHeight: 56 }}>
          {t('Teilen')}
        </Button>
      </Box>
      {grants.map((grant) => (
        <Box key={grant.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {grant.group ? <GroupAvatar size={36} /> : <UserAvatar initials={grant.user?.initials ?? '?'} size={36} />}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
              {grant.group?.name ?? grant.user?.name ?? t('Gelöschtes Konto')}
            </Typography>
            <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
              {grant.group
                ? tn(grant.group.members, 'Gruppe mit {count} Person', 'Gruppe mit {count} Personen')
                : `@${grant.user?.username ?? ''}`}
            </Typography>
          </Box>
          <Select
            size="small"
            value={grant.permission}
            aria-label={t('Recht von {name}', { name: grant.group?.name ?? grant.user?.name ?? '' })}
            onChange={async (event) => {
              try {
                const result = await api.patch<{ grant: SharedGrant }>(`/api/grants/${grant.id}`, { permission: event.target.value });
                onChange(grants.map((entry) => (entry.id === grant.id ? result.grant : entry)));
              } catch (error) {
                toast(errorText(error));
              }
            }}
          >
            <MenuItem value="view">{t('Kann ansehen')}</MenuItem>
            <MenuItem value="edit">{t('Kann bearbeiten')}</MenuItem>
          </Select>
          <Tooltip title={t('Freigabe entfernen')}>
            <IconButton
              aria-label={t('Freigabe für {name} entfernen', { name: grant.group?.name ?? grant.user?.name ?? '' })}
              onClick={async () => {
                try {
                  await api.delete(`/api/grants/${grant.id}`);
                  onChange(grants.filter((entry) => entry.id !== grant.id));
                } catch (error) {
                  toast(errorText(error));
                }
              }}
            >
              <PersonRemoveRounded />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
    </Box>
  );
}

export function ShareDialog({ item, onClose, onChanged }: { item: Item | null; onClose: () => void; onChanged?: () => void }) {
  const theme = useTheme();
  const small = useMediaQuery(theme.breakpoints.down('sm'));
  const [data, setData] = useState<{ id: string; shares: Shares } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rules = settings();

  useEffect(() => {
    if (!item) return;
    const abort = new AbortController();
    api
      .get<Shares>(`/api/nodes/${item.id}/shares`, abort.signal)
      .then((shares) => setData({ id: item.id, shares }))
      .catch((reason: Error) => reason.name !== 'AbortError' && setError(errorText(reason)));
    return () => abort.abort();
  }, [item]);

  const shares = data && item && data.id === item.id ? data.shares : null;
  const update = (patch: Partial<Shares>) => {
    if (!shares || !item) return;
    setData({ id: item.id, shares: { ...shares, ...patch } });
    onChanged?.();
  };

  const quickLink = async () => {
    if (!item || !shares) return;
    if (rules.requirePassword || rules.maxDays) {
      setCreating(true);
      return;
    }
    try {
      const result = await api.post<{ link: SharedLink }>(`/api/nodes/${item.id}/links`, {});
      update({ links: [result.link, ...shares.links] });
      await copyText(result.link.url, t('Link erstellt und kopiert'));
    } catch (reason) {
      toast(errorText(reason));
    }
  };

  const close = () => {
    setCreating(false);
    setError(null);
    onClose();
  };

  return (
    <Dialog open={Boolean(item)} onClose={close} fullWidth maxWidth="sm" fullScreen={small} aria-labelledby="share-title">
      <DialogTitle id="share-title" sx={{ overflowWrap: 'anywhere' }}>
        {item ? t('„{name}“ teilen', { name: item.name }) : ''}
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {!shares && !error && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress aria-label={t('Lädt')} />
          </Box>
        )}
        {error && <Typography sx={{ color: c.error }}>{error}</Typography>}
        {shares && item && (
          <>
            {shares.canGrant && (
              <Box component="section" aria-labelledby="share-people" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Typography id="share-people" variant="subtitle1" sx={{ fontWeight: 700, color: c.onSurface }}>
                  {t('Personen')}
                </Typography>
                <People item={item} grants={shares.grants} onChange={(grants) => update({ grants })} />
              </Box>
            )}
            {shares.canLink && (
              <Box component="section" aria-labelledby="share-links" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography id="share-links" variant="subtitle1" sx={{ fontWeight: 700, color: c.onSurface, flex: 1 }}>
                    {t('Öffentliche Links')}
                  </Typography>
                  {shares.links.length > 0 && !creating && (
                    <Button startIcon={<AddLinkRounded />} onClick={() => void quickLink()}>
                      {t('Weiterer Link')}
                    </Button>
                  )}
                </Box>
                {shares.links.length === 0 && !creating && (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2,
                      bgcolor: c.surfaceContainer,
                      borderRadius: `${radius.md}px`,
                      p: 2,
                      flexWrap: 'wrap',
                    }}
                  >
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>
                      {t('Mit einem Link kann jede Person, die ihn kennt, „{name}“ öffnen. Ein Konto braucht sie nicht.', {
                        name: item.name,
                      })}
                    </Typography>
                    <Button variant="contained" startIcon={<AddLinkRounded />} onClick={() => void quickLink()}>
                      {t('Link erstellen')}
                    </Button>
                  </Box>
                )}
                <Collapse in={creating} unmountOnExit>
                  <Box sx={{ bgcolor: c.surfaceContainer, borderRadius: `${radius.md}px`, p: 2 }}>
                    <LinkForm
                      item={item}
                      link={null}
                      onSaved={(link) => {
                        update({ links: [link, ...shares.links] });
                        setCreating(false);
                        void copyText(link.url, t('Link erstellt und kopiert'));
                      }}
                      onCancel={() => setCreating(false)}
                    />
                  </Box>
                </Collapse>
                {shares.links.map((link) => (
                  <LinkCard
                    key={link.id}
                    item={item}
                    link={link}
                    onChange={(saved) => update({ links: shares.links.map((entry) => (entry.id === saved.id ? saved : entry)) })}
                    onDelete={async () => {
                      const ok = await confirm({
                        title: t('Link löschen?'),
                        text: t('Wer den Link hat, kommt danach nicht mehr an „{name}“.', { name: item.name }),
                        confirm: t('Löschen'),
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api.delete(`/api/links/${link.id}`);
                        update({ links: shares.links.filter((entry) => entry.id !== link.id) });
                        toast(t('Link gelöscht'));
                      } catch (reason) {
                        toast(errorText(reason));
                      }
                    }}
                  />
                ))}
              </Box>
            )}
            {!shares.canGrant && !shares.canLink && (
              <Typography variant="body2">{t('Teilen ist für dieses Element nicht möglich.')}</Typography>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={close}>
          {t('Fertig')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
