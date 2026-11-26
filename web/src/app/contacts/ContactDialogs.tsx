import { useEffect, useRef, useState, type DragEvent } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import KeyRounded from '@mui/icons-material/KeyRounded';
import PersonRemoveRounded from '@mui/icons-material/PersonRemoveRounded';
import UploadFileRounded from '@mui/icons-material/UploadFileRounded';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { CopyField, UserAvatar } from '../common/bits';
import { toast } from '../common/toast';
import { contactsApi, type Book, type ImportJob } from './model';

type Step = 'source' | 'reading' | 'preview' | 'running' | 'done';

export function ImportDialog({
  books,
  node,
  defaultBook,
  onClose,
  onDone,
}: {
  books: Book[];
  node: string | null;
  defaultBook: string;
  onClose: () => void;
  onDone: (bookId: string) => void;
}) {
  const mobile = useMediaQuery('(max-width:600px)');
  const writable = books.filter((book) => book.access !== 'read');
  const [step, setStep] = useState<Step>(node ? 'reading' : 'source');
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [target, setTarget] = useState(writable.some((book) => book.id === defaultBook) ? defaultBook : (writable[0]?.id ?? 'new'));
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'merge' | 'skip' | 'copy'>('merge');
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; book: Book } | null>(null);
  const started = useRef(false);

  const begin = async (load: () => Promise<ImportJob>) => {
    setStep('reading');
    setError(null);
    try {
      const next = await load();
      setJob(next);
      setName(next.files[0]?.replace(/\.[^.]+$/, '') ?? '');
      setStep('preview');
    } catch (failure) {
      setError(errorText(failure));
      setStep('source');
    }
  };

  useEffect(() => {
    if (!node || started.current) return;
    started.current = true;
    void begin(() => contactsApi.importNode(node));
  }, [node]);

  const pick = (files: File[]) => {
    if (files.length) void begin(() => contactsApi.importFiles(files));
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    pick([...event.dataTransfer.files]);
  };

  const close = () => {
    if (job && step !== 'done') void contactsApi.discardImport(job.id).catch(() => undefined);
    onClose();
  };

  const run = async () => {
    if (!job) return;
    setStep('running');
    try {
      const outcome = await contactsApi.runImport(job.id, target, name, mode);
      setResult(outcome);
      setStep('done');
    } catch (failure) {
      setError(errorText(failure));
      setStep('preview');
    }
  };

  return (
    <Dialog
      open
      fullScreen={mobile}
      maxWidth="sm"
      fullWidth
      onClose={step === 'running' ? undefined : close}
      data-contact-import
      slotProps={{ paper: { sx: { borderRadius: mobile ? 0 : `${radius.xl}px` } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {t('Kontakte importieren')}
        </Box>
        <IconButton aria-label={t('Schließen')} onClick={close} disabled={step === 'running'}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error">{error}</Alert>}
        {step === 'source' && (
          <Box
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 1.5,
              p: 3,
              borderRadius: `${radius.lg}px`,
              border: `2px dashed ${dragging ? c.primary : c.outlineVariant}`,
              bgcolor: dragging ? c.primaryContainer : 'transparent',
            }}
          >
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t(
                'vCard-Dateien von iPhone, Android, Outlook und Thunderbird, CSV aus Google Kontakte oder Outlook und ZIP-Archive aus Google Takeout. Auch mehrere auf einmal.'
              )}
            </Typography>
            <Button component="label" variant="contained" startIcon={<UploadFileRounded />}>
              {t('Dateien auswählen')}
              <input
                hidden
                multiple
                type="file"
                accept=".vcf,.vcard,.csv,.zip,text/vcard,text/x-vcard,text/csv,application/zip"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = '';
                  pick(files);
                }}
              />
            </Button>
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {t('Oder zieh die Dateien hierher.')}
            </Typography>
          </Box>
        )}
        {(step === 'reading' || step === 'running') && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4, justifyContent: 'center' }}>
            <CircularProgress size={28} />
            <Typography>{step === 'reading' ? t('MoeCloud liest die Kontakte …') : t('Kontakte werden importiert …')}</Typography>
          </Box>
        )}
        {step === 'preview' && job && (
          <>
            <Typography variant="body2" data-import-count={job.count}>
              {tn(job.count, 'MoeCloud hat einen Kontakt gefunden.', 'MoeCloud hat {count} Kontakte gefunden.')}
              {job.groups > 0 && ` ${tn(job.groups, 'Dazu kommt eine Gruppe.', 'Dazu kommen {count} Gruppen.')}`}
            </Typography>
            {job.warnings.map((warning, index) => (
              <Alert key={index} severity="warning">
                {t(warning.message, warning.params)}
              </Alert>
            ))}
            <Box
              component="ul"
              sx={{
                m: 0,
                p: 0,
                listStyle: 'none',
                borderRadius: `${radius.md}px`,
                border: `1px solid ${c.outlineVariant}`,
                overflow: 'hidden',
              }}
            >
              {job.sample.map((entry, index) => (
                <Box
                  component="li"
                  key={index}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    borderTop: index ? `1px solid ${c.outlineVariant}` : 'none',
                  }}
                >
                  <UserAvatar initials={(entry.name || '?').slice(0, 2).toUpperCase()} size={32} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {entry.name || t('Ohne Namen')}
                    </Typography>
                    <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                      {entry.email ?? entry.phone ?? ''}
                    </Typography>
                  </Box>
                </Box>
              ))}
              {job.count > job.sample.length && (
                <Typography
                  component="li"
                  variant="caption"
                  sx={{ display: 'block', px: 1.5, py: 1, color: c.onSurfaceVariant, borderTop: `1px solid ${c.outlineVariant}` }}
                >
                  {tn(job.count - job.sample.length, 'und ein weiterer', 'und {count} weitere')}
                </Typography>
              )}
            </Box>
            <TextField select size="small" label={t('Importieren in')} value={target} onChange={(event) => setTarget(event.target.value)}>
              {writable.map((book) => (
                <MenuItem key={book.id} value={book.id}>
                  {book.owner ? t('{name} ({owner})', { name: book.name, owner: book.owner.name }) : book.name}
                </MenuItem>
              ))}
              <MenuItem value="new">{t('Neues Adressbuch')}</MenuItem>
            </TextField>
            {target === 'new' && (
              <TextField size="small" label={t('Name des Adressbuchs')} value={name} onChange={(event) => setName(event.target.value)} />
            )}
            <TextField
              select
              size="small"
              label={t('Wenn ein Kontakt schon existiert')}
              value={mode}
              onChange={(event) => setMode(event.target.value as 'merge' | 'skip' | 'copy')}
            >
              <MenuItem value="merge">{t('Aktualisieren')}</MenuItem>
              <MenuItem value="skip">{t('Überspringen')}</MenuItem>
              <MenuItem value="copy">{t('Doppelt anlegen')}</MenuItem>
            </TextField>
          </>
        )}
        {step === 'done' && result && (
          <Box data-import-done sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1, py: 2 }}>
            <CheckCircleRounded sx={{ fontSize: 48, color: c.primary }} />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('Import in „{name}“ fertig', { name: result.book.name })}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {t('Neu: {created}, aktualisiert: {updated}, übersprungen: {skipped}', {
                created: result.created,
                updated: result.updated,
                skipped: result.skipped,
              })}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {step === 'preview' && (
          <>
            <Button onClick={close}>{t('Abbrechen')}</Button>
            <Button variant="contained" onClick={() => void run()} disabled={!job?.count && !job?.groups}>
              {tn(job?.count ?? 0, 'Einen Kontakt importieren', '{count} Kontakte importieren')}
            </Button>
          </>
        )}
        {step === 'done' && result && (
          <Button variant="contained" onClick={() => onDone(result.book.id)}>
            {t('Fertig')}
          </Button>
        )}
        {step === 'source' && <Button onClick={close}>{t('Abbrechen')}</Button>}
      </DialogActions>
    </Dialog>
  );
}

interface Person {
  id: number;
  username: string;
  name: string;
  initials: string;
  avatar: string | null;
  guest?: boolean;
}

export function ShareDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const [shares, setShares] = useState<{ user: Person; permission: 'read' | 'write' }[] | null>(null);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Person[]>([]);
  const [permission, setPermission] = useState<'read' | 'write'>('read');

  const load = () =>
    contactsApi
      .shares(book.id)
      .then(setShares)
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, [book.id]);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setOptions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .get<{ items: Person[] }>(`/api/users/search?q=${encodeURIComponent(text)}`)
        .then((result) => setOptions(result.items.filter((person) => !person.guest)))
        .catch(() => setOptions([]));
    }, 160);
    return () => window.clearTimeout(timer);
  }, [query]);

  const add = async (person: Person | null) => {
    if (!person) return;
    try {
      await contactsApi.share(book.id, person.id, permission);
      setQuery('');
      await load();
    } catch (error) {
      toast(errorText(error));
    }
  };

  const known = new Set((shares ?? []).map((entry) => entry.user.id));

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      data-contact-share
      slotProps={{ paper: { sx: { borderRadius: `${radius.xl}px` } } }}
    >
      <DialogTitle>{t('„{name}“ teilen', { name: book.name })}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Geteilte Adressbücher erscheinen bei den anderen im Browser und auf ihren Geräten.')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Autocomplete
            fullWidth
            size="small"
            options={options.filter((person) => !known.has(person.id))}
            filterOptions={(list) => list}
            getOptionLabel={(person) => person.name}
            inputValue={query}
            onInputChange={(_event, value, reason) => reason !== 'reset' && setQuery(value)}
            value={null}
            onChange={(_event, person) => void add(person)}
            noOptionsText={query.trim() ? t('Niemand gefunden') : t('Name oder Benutzername eingeben')}
            renderOption={(props, person) => {
              const { key, ...rest } = props;
              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
                  <UserAvatar initials={person.initials} avatar={person.avatar} userId={person.id} size={28} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {person.name}
                    </Typography>
                    <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                      @{person.username}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
            renderInput={(params) => <TextField {...params} label={t('Person hinzufügen')} />}
          />
          <TextField
            select
            size="small"
            label={t('Recht')}
            value={permission}
            onChange={(event) => setPermission(event.target.value as 'read' | 'write')}
            sx={{ width: 130, flex: 'none' }}
          >
            <MenuItem value="read">{t('Ansehen')}</MenuItem>
            <MenuItem value="write">{t('Bearbeiten')}</MenuItem>
          </TextField>
        </Box>
        {shares && shares.length === 0 && (
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Noch mit niemandem geteilt.')}
          </Typography>
        )}
        {shares?.map((entry) => (
          <Box key={entry.user.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <UserAvatar initials={entry.user.initials} avatar={entry.user.avatar} userId={entry.user.id} size={32} />
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
              {entry.user.name}
            </Typography>
            <TextField
              select
              size="small"
              value={entry.permission}
              aria-label={t('Recht für {name}', { name: entry.user.name })}
              onChange={async (event) => {
                try {
                  await contactsApi.share(book.id, entry.user.id, event.target.value as 'read' | 'write');
                  await load();
                } catch (error) {
                  toast(errorText(error));
                }
              }}
              sx={{ width: 130 }}
            >
              <MenuItem value="read">{t('Ansehen')}</MenuItem>
              <MenuItem value="write">{t('Bearbeiten')}</MenuItem>
            </TextField>
            <Tooltip title={t('Nicht mehr teilen')}>
              <IconButton
                aria-label={t('Nicht mehr teilen')}
                onClick={async () => {
                  try {
                    await contactsApi.unshare(book.id, entry.user.id);
                    await load();
                  } catch (error) {
                    toast(errorText(error));
                  }
                }}
              >
                <PersonRemoveRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('Fertig')}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function SyncDialog({ onClose }: { onClose: () => void }) {
  const address = boot().contactsOn?.carddav ?? `${location.origin}/carddav/`;
  const username = boot().user?.username ?? '';
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-contact-sync
      slotProps={{ paper: { sx: { borderRadius: `${radius.xl}px` } } }}
    >
      <DialogTitle>{t('Kontakte auf deinen Geräten')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t(
            'MoeCloud spricht CardDAV. So landen deine Adressbücher auf iPhone und Mac, auf Android mit DAVx⁵, in Thunderbird und vielen anderen Apps. Änderungen gehen in beide Richtungen.'
          )}
        </Typography>
        <CopyField label={t('Server-Adresse')} value={address} />
        <CopyField label={t('Benutzername')} value={username} mono={false} />
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Als Passwort nimmst du ein App-Passwort. Dein normales Passwort funktioniert dort aus Sicherheitsgründen nicht.')}
        </Typography>
        <Button variant="tonal" startIcon={<KeyRounded />} href="/account#app-passwoerter" sx={{ alignSelf: 'flex-start' }}>
          {t('App-Passwort erstellen')}
        </Button>
        <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 0.75, color: c.onSurfaceVariant }}>
          <Typography component="li" variant="body2">
            {t('iPhone und iPad: Einstellungen › Apps › Kontakte › Accounts › Account hinzufügen › Andere › CardDAV-Account.')}
          </Typography>
          <Typography component="li" variant="body2">
            {t('Android: In DAVx⁵ ein Konto mit Adresse und Benutzername anlegen, Kalender und Kontakte kommen zusammen.')}
          </Typography>
          <Typography component="li" variant="body2">
            {t('Thunderbird: Adressbuch › Neues Adressbuch › CardDAV-Adressbuch hinzufügen.')}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('Fertig')}</Button>
      </DialogActions>
    </Dialog>
  );
}
