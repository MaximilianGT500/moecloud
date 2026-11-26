import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddRounded from '@mui/icons-material/AddRounded';
import BusinessRounded from '@mui/icons-material/BusinessRounded';
import CakeRounded from '@mui/icons-material/CakeRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import PhoneRounded from '@mui/icons-material/PhoneRounded';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import SellOutlined from '@mui/icons-material/SellOutlined';
import { errorText } from '../../lib/api';
import { locale, t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { toast } from '../common/toast';
import {
  EMAIL_TYPES,
  PHONE_TYPES,
  composeName,
  contactsApi,
  emptyData,
  initialsOf,
  parseDay,
  photoUrl,
  typeLabel,
  type Address,
  type Book,
  type ContactData,
  type Detail,
  type Entry,
  type EntryType,
} from './model';

export interface EditorRequest {
  detail: Detail | null;
  bookId: string;
  preset?: Partial<ContactData>;
}

const MONTHS = Array.from({ length: 12 }, (_value, index) =>
  new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, index, 1)))
);

function DateField({
  label,
  value,
  onChange,
  icon,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  icon: ReactNode;
}) {
  const parts = value ? parseDay(value) : null;
  const [day, setDay] = useState(parts ? String(parts.day) : '');
  const [month, setMonth] = useState(parts ? String(parts.month) : '');
  const [year, setYear] = useState(parts?.year ? String(parts.year) : '');
  const update = (next: { day?: string; month?: string; year?: string }) => {
    const d = next.day ?? day;
    const m = next.month ?? month;
    const y = next.year ?? year;
    if (next.day !== undefined) setDay(d);
    if (next.month !== undefined) setMonth(m);
    if (next.year !== undefined) setYear(y);
    const dayNumber = Number(d);
    const monthNumber = Number(m);
    if (!d && !m && !y) return onChange(null);
    if (!dayNumber || !monthNumber || dayNumber > 31) return onChange(null);
    const prefix = /^\d{4}$/.test(y) ? y : '-';
    onChange(`${prefix}-${String(monthNumber).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`);
  };
  return (
    <Row icon={icon} label={label}>
      <Box role="group" aria-label={label} sx={{ display: 'grid', gridTemplateColumns: '76px 1fr 96px', gap: 1, flex: 1 }}>
        <TextField
          size="small"
          label={t('Tag')}
          value={day}
          inputMode="numeric"
          onChange={(event) => update({ day: event.target.value.replace(/\D/g, '').slice(0, 2) })}
        />
        <TextField select size="small" label={t('Monat')} value={month} onChange={(event) => update({ month: event.target.value })}>
          <MenuItem value="">{t('Keiner')}</MenuItem>
          {MONTHS.map((name, index) => (
            <MenuItem key={name} value={String(index + 1)}>
              {name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label={t('Jahr')}
          value={year}
          inputMode="numeric"
          placeholder={t('optional')}
          onChange={(event) => update({ year: event.target.value.replace(/\D/g, '').slice(0, 4) })}
        />
      </Box>
    </Row>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label?: string; children: ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Box sx={{ color: c.onSurfaceVariant, pt: 1, display: 'flex' }} aria-hidden title={label}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>{children}</Box>
    </Box>
  );
}

function TypeSelect({
  value,
  types,
  label,
  onChange,
}: {
  value: Entry;
  types: EntryType[];
  label: string;
  onChange: (entry: Entry) => void;
}) {
  const custom = value.label ? `custom:${value.label}` : value.type;
  return (
    <TextField
      select
      size="small"
      label={label}
      value={custom}
      onChange={(event) => onChange({ ...value, type: event.target.value as EntryType, label: null })}
      sx={{ width: 132, flex: 'none' }}
    >
      {value.label && <MenuItem value={custom}>{value.label}</MenuItem>}
      {types.map((type) => (
        <MenuItem key={type} value={type}>
          {typeLabel(type)}
        </MenuItem>
      ))}
    </TextField>
  );
}

function EntryList({
  items,
  types,
  icon,
  label,
  add,
  inputType,
  placeholder,
  onChange,
  name,
}: {
  items: Entry[];
  types: EntryType[];
  icon: ReactNode;
  label: string;
  add: string;
  inputType: string;
  placeholder?: string;
  onChange: (items: Entry[]) => void;
  name: string;
}) {
  return (
    <Row icon={icon} label={label}>
      {items.map((entry, index) => (
        <Box key={index} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TypeSelect
            value={entry}
            types={types}
            label={t('Art')}
            onChange={(next) => onChange(items.map((item, position) => (position === index ? next : item)))}
          />
          <TextField
            size="small"
            fullWidth
            label={label}
            type={inputType}
            name={`${name}-${index}`}
            placeholder={placeholder}
            value={entry.value}
            onChange={(event) =>
              onChange(items.map((item, position) => (position === index ? { ...item, value: event.target.value } : item)))
            }
          />
          <Tooltip title={t('Entfernen')}>
            <IconButton aria-label={t('Entfernen')} onClick={() => onChange(items.filter((_item, position) => position !== index))}>
              <CloseRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Box>
        <Button
          size="small"
          startIcon={<AddRounded />}
          onClick={() => onChange([...items, { type: items.length ? 'other' : types[0], value: '', label: null }])}
        >
          {add}
        </Button>
      </Box>
    </Row>
  );
}

const emptyAddress = (type: EntryType): Address => ({
  type,
  label: null,
  street: '',
  locality: '',
  region: '',
  code: '',
  country: '',
  pobox: '',
  extended: '',
});

export function ContactEditor({
  request,
  books,
  labels,
  onClose,
  onSaved,
}: {
  request: EditorRequest;
  books: Book[];
  labels: string[];
  onClose: () => void;
  onSaved: (detail: Detail) => void;
}) {
  const mobile = useMediaQuery('(max-width:600px)');
  const initial = useMemo(() => ({ ...emptyData(), ...(request.detail?.data ?? {}), ...(request.preset ?? {}) }), [request]);
  const [data, setData] = useState<ContactData>(initial);
  const [bookId, setBookId] = useState(request.detail?.bookId ?? request.bookId);
  const [more, setMore] = useState(Boolean(initial.prefix || initial.additional || initial.suffix || initial.nickname));
  const autoName = useRef(!initial.name || initial.name === composeName(initial) || initial.name === initial.organization);
  const [busy, setBusy] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const writable = books.filter((book) => book.access !== 'read');

  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const set = (patch: Partial<ContactData>) => setData((current) => ({ ...current, ...patch }));
  const org = data.kind === 'org';
  const display = autoName.current ? (org ? data.organization : composeName(data)) || data.name : data.name;
  const shownPhoto = preview ?? (!dropPhoto && request.detail?.photo ? photoUrl(request.detail.id, request.detail.photo) : undefined);
  const empty =
    !display.trim() &&
    !data.given.trim() &&
    !data.family.trim() &&
    !data.organization.trim() &&
    !data.nickname.trim() &&
    !data.emails.some((entry) => entry.value.trim()) &&
    !data.phones.some((entry) => entry.value.trim());

  const save = async () => {
    if (empty) {
      toast(t('Gib mindestens einen Namen, eine E-Mail-Adresse oder eine Telefonnummer an'));
      return;
    }
    setBusy(true);
    try {
      const payload: ContactData = {
        ...data,
        name: autoName.current ? (org ? data.organization.trim() : '') : data.name.trim(),
        emails: data.emails.filter((entry) => entry.value.trim()),
        phones: data.phones.filter((entry) => entry.value.trim()),
        urls: data.urls.filter((entry) => entry.value.trim()),
        addresses: data.addresses.filter((entry) =>
          [entry.street, entry.locality, entry.code, entry.region, entry.country].some((part) => part.trim())
        ),
      };
      let saved = request.detail
        ? await contactsApi.update(request.detail.id, payload, bookId !== request.detail.bookId ? bookId : undefined)
        : await contactsApi.create(bookId, payload);
      if (photo) saved = await contactsApi.photo(saved.id, photo);
      else if (dropPhoto && saved.photo) saved = await contactsApi.removePhoto(saved.id);
      toast(request.detail ? t('Kontakt gespeichert') : t('Kontakt angelegt'));
      onSaved(saved);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      fullScreen={mobile}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      data-contact-editor
      slotProps={{ paper: { sx: { borderRadius: mobile ? 0 : `${radius.xl}px` } } }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1 }}>
        <Box component="span" sx={{ flex: 1 }}>
          {request.detail ? t('Kontakt bearbeiten') : t('Neuer Kontakt')}
        </Box>
        <IconButton aria-label={t('Schließen')} onClick={onClose} disabled={busy}>
          <CloseRounded />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Box
          component="form"
          id="contact-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.25 }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={shownPhoto}
                alt=""
                sx={{ width: 88, height: 88, fontSize: 32, bgcolor: c.primaryContainer, color: c.onPrimaryContainer }}
              >
                {initialsOf(display || data.emails[0]?.value || '?')}
              </Avatar>
              <Tooltip title={t('Foto wählen')}>
                <IconButton
                  component="label"
                  aria-label={t('Foto wählen')}
                  size="small"
                  sx={{
                    position: 'absolute',
                    right: -4,
                    bottom: -4,
                    bgcolor: c.secondaryContainer,
                    color: c.onSecondaryContainer,
                    '&:hover': { bgcolor: c.secondaryContainer },
                  }}
                >
                  <PhotoCameraRounded fontSize="small" />
                  <input
                    hidden
                    type="file"
                    accept="image/*"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) {
                        setPhoto(file);
                        setDropPhoto(false);
                      }
                    }}
                  />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="h6" noWrap sx={{ fontWeight: 700 }}>
                {display || t('Ohne Namen')}
              </Typography>
              {(shownPhoto || photo) && (
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    setPhoto(null);
                    setDropPhoto(true);
                  }}
                >
                  {t('Foto entfernen')}
                </Button>
              )}
            </Box>
          </Box>

          <FormControlLabel
            control={<Checkbox checked={org} onChange={(event) => set({ kind: event.target.checked ? 'org' : 'individual' })} />}
            label={t('Das ist eine Firma oder Einrichtung')}
          />

          <Row icon={<PersonOutlineRounded />} label={t('Name')}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <TextField
                size="small"
                label={t('Vorname')}
                value={data.given}
                onChange={(event) => set({ given: event.target.value })}
                autoFocus={!request.detail}
              />
              <TextField size="small" label={t('Nachname')} value={data.family} onChange={(event) => set({ family: event.target.value })} />
            </Box>
            <Button
              size="small"
              color="inherit"
              onClick={() => setMore((value) => !value)}
              endIcon={<ExpandMoreRounded sx={{ transform: more ? 'rotate(180deg)' : 'none' }} />}
              sx={{ alignSelf: 'flex-start' }}
            >
              {more ? t('Weniger Namensfelder') : t('Weitere Namensfelder')}
            </Button>
            <Collapse in={more} unmountOnExit>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1, pt: 0.5 }}>
                <TextField
                  size="small"
                  label={t('Anrede oder Titel')}
                  value={data.prefix}
                  onChange={(event) => set({ prefix: event.target.value })}
                />
                <TextField
                  size="small"
                  label={t('Zweiter Vorname')}
                  value={data.additional}
                  onChange={(event) => set({ additional: event.target.value })}
                />
                <TextField
                  size="small"
                  label={t('Namenszusatz')}
                  value={data.suffix}
                  onChange={(event) => set({ suffix: event.target.value })}
                />
                <TextField
                  size="small"
                  label={t('Spitzname')}
                  value={data.nickname}
                  onChange={(event) => set({ nickname: event.target.value })}
                />
                <TextField
                  size="small"
                  label={t('Anzeigename')}
                  value={display}
                  onChange={(event) => {
                    autoName.current = false;
                    set({ name: event.target.value });
                  }}
                  helperText={t('So steht der Kontakt in Listen und auf Telefonen')}
                  sx={{ gridColumn: { sm: '1 / -1' } }}
                />
              </Box>
            </Collapse>
          </Row>

          <Row icon={<BusinessRounded />} label={t('Arbeit')}>
            <TextField
              size="small"
              label={t('Firma')}
              value={data.organization}
              onChange={(event) => set({ organization: event.target.value })}
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
              <TextField
                size="small"
                label={t('Abteilung')}
                value={data.department}
                onChange={(event) => set({ department: event.target.value })}
              />
              <TextField size="small" label={t('Position')} value={data.title} onChange={(event) => set({ title: event.target.value })} />
            </Box>
          </Row>

          <EntryList
            name="phone"
            items={data.phones}
            types={PHONE_TYPES}
            icon={<PhoneRounded />}
            label={t('Telefon')}
            add={t('Telefonnummer hinzufügen')}
            inputType="tel"
            onChange={(phones) => set({ phones })}
          />
          <EntryList
            name="email"
            items={data.emails}
            types={EMAIL_TYPES}
            icon={<MailOutlineRounded />}
            label={t('E-Mail')}
            add={t('E-Mail-Adresse hinzufügen')}
            inputType="email"
            onChange={(emails) => set({ emails })}
          />

          <Row icon={<PlaceOutlined />} label={t('Adresse')}>
            {data.addresses.map((address, index) => {
              const change = (patch: Partial<Address>) =>
                set({ addresses: data.addresses.map((item, position) => (position === index ? { ...item, ...patch } : item)) });
              return (
                <Box
                  key={index}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    p: 1.25,
                    borderRadius: `${radius.md}px`,
                    border: `1px solid ${c.outlineVariant}`,
                  }}
                >
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <TypeSelect
                      value={{ type: address.type, label: address.label, value: '' }}
                      types={EMAIL_TYPES}
                      label={t('Art')}
                      onChange={(next) => change({ type: next.type, label: next.label })}
                    />
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title={t('Adresse entfernen')}>
                      <IconButton
                        aria-label={t('Adresse entfernen')}
                        onClick={() => set({ addresses: data.addresses.filter((_item, position) => position !== index) })}
                      >
                        <DeleteOutlineRounded fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <TextField
                    size="small"
                    label={t('Straße und Hausnummer')}
                    value={address.street}
                    multiline
                    maxRows={3}
                    onChange={(event) => change({ street: event.target.value })}
                  />
                  <Box sx={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 1 }}>
                    <TextField
                      size="small"
                      label={t('PLZ')}
                      value={address.code}
                      onChange={(event) => change({ code: event.target.value })}
                    />
                    <TextField
                      size="small"
                      label={t('Ort')}
                      value={address.locality}
                      onChange={(event) => change({ locality: event.target.value })}
                    />
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                    <TextField
                      size="small"
                      label={t('Bundesland oder Region')}
                      value={address.region}
                      onChange={(event) => change({ region: event.target.value })}
                    />
                    <TextField
                      size="small"
                      label={t('Land')}
                      value={address.country}
                      onChange={(event) => change({ country: event.target.value })}
                    />
                  </Box>
                </Box>
              );
            })}
            <Box>
              <Button
                size="small"
                startIcon={<AddRounded />}
                onClick={() => set({ addresses: [...data.addresses, emptyAddress(data.addresses.length ? 'work' : 'home')] })}
              >
                {t('Adresse hinzufügen')}
              </Button>
            </Box>
          </Row>

          <EntryList
            name="url"
            items={data.urls}
            types={EMAIL_TYPES}
            icon={<LinkRounded />}
            label={t('Webseite')}
            add={t('Webseite hinzufügen')}
            inputType="url"
            placeholder="https://"
            onChange={(urls) => set({ urls })}
          />

          {!org && (
            <DateField label={t('Geburtstag')} icon={<CakeRounded />} value={data.birthday} onChange={(birthday) => set({ birthday })} />
          )}
          {!org && (
            <DateField
              label={t('Jahrestag')}
              icon={<FavoriteBorderRounded />}
              value={data.anniversary}
              onChange={(anniversary) => set({ anniversary })}
            />
          )}

          <Row icon={<SellOutlined />} label={t('Labels')}>
            <Autocomplete
              multiple
              freeSolo
              size="small"
              options={labels.filter((label) => !data.categories.includes(label))}
              value={data.categories}
              onChange={(_event, value) => set({ categories: [...new Set(value.map((entry) => entry.trim()).filter(Boolean))] })}
              renderValue={(value, getItemProps) =>
                value.map((option, index) => {
                  const { key, ...props } = getItemProps({ index });
                  return <Chip key={key} size="small" label={option} {...props} />;
                })
              }
              renderInput={(params) => <TextField {...params} label={t('Labels')} placeholder={t('Zum Beispiel Familie')} />}
            />
          </Row>

          <Row icon={<NotesRounded />} label={t('Notiz')}>
            <TextField
              size="small"
              label={t('Notiz')}
              value={data.note}
              multiline
              minRows={2}
              maxRows={8}
              onChange={(event) => set({ note: event.target.value })}
            />
          </Row>

          {writable.length > 1 && (
            <TextField select size="small" label={t('Adressbuch')} value={bookId} onChange={(event) => setBookId(event.target.value)}>
              {writable.map((book) => (
                <MenuItem key={book.id} value={book.id}>
                  {book.owner ? t('{name} ({owner})', { name: book.name, owner: book.owner.name }) : book.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          {t('Abbrechen')}
        </Button>
        <Button type="submit" form="contact-form" variant="contained" disabled={busy}>
          {t('Speichern')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
