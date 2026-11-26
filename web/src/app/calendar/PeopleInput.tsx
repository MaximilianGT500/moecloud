import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import AlternateEmailRounded from '@mui/icons-material/AlternateEmailRounded';
import { api } from '../../lib/api';
import { boot } from '../../lib/boot';
import { featureOn } from '../../lib/features';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { UserAvatar } from '../common/bits';

export interface Person {
  id: number;
  username: string;
  name: string;
  email: string | null;
  initials: string;
}

export interface Picked {
  email: string;
  name: string | null;
  userId: number | null;
  initials: string;
  contact?: boolean;
}

interface ContactHit {
  contactId: string;
  name: string;
  email: string;
  initials: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailOf = (person: Person) => (person.email ?? `${person.username}@users.moecloud.invalid`).toLowerCase();

export function PeopleInput({
  onPick,
  exclude = [],
  allowEmail = true,
  label = t('Personen hinzufügen'),
  autoFocus,
}: {
  onPick: (person: Picked) => void;
  exclude?: string[];
  allowEmail?: boolean;
  label?: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<Person[]>([]);
  const [contacts, setContacts] = useState<ContactHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const latest = useRef('');

  useEffect(() => {
    const query = text.trim();
    latest.current = query;
    if (query.length < 1) {
      setFound([]);
      setContacts([]);
      return;
    }
    const withContacts = allowEmail && Boolean(boot().contactsOn) && featureOn('contacts');
    const timer = window.setTimeout(() => {
      api
        .get<{ items: Person[]; contacts?: ContactHit[] }>(
          `/api/calendar/people?q=${encodeURIComponent(query)}${withContacts ? '&contacts=1' : ''}`
        )
        .then((result) => {
          if (latest.current !== query) return;
          setFound(result.items);
          setContacts(result.contacts ?? []);
        })
        .catch(() => undefined);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [text, allowEmail]);

  const query = text.trim();
  const people = found.filter((person) => !exclude.includes(emailOf(person)));
  const known = new Set(people.map((person) => person.email?.toLowerCase()).filter(Boolean));
  const fromContacts = allowEmail ? contacts.filter((hit) => !exclude.includes(hit.email) && !known.has(hit.email)) : [];
  const asEmail =
    allowEmail &&
    EMAIL.test(query) &&
    !exclude.includes(query.toLowerCase()) &&
    !people.some((person) => person.email?.toLowerCase() === query.toLowerCase()) &&
    !fromContacts.some((hit) => hit.email === query.toLowerCase());
  const options: Picked[] = [
    ...people.map((person) => ({ email: emailOf(person), name: person.name, userId: person.id, initials: person.initials })),
    ...fromContacts.map((hit) => ({ email: hit.email, name: hit.name, userId: null, initials: hit.initials, contact: true })),
    ...(asEmail ? [{ email: query.toLowerCase(), name: null, userId: null, initials: query.slice(0, 1).toUpperCase() }] : []),
  ];
  const current = Math.min(active, Math.max(0, options.length - 1));

  const pick = (option: Picked | undefined) => {
    if (!option) return;
    onPick(option);
    setText('');
    setFound([]);
    setActive(0);
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current + 1) % Math.max(1, options.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current - 1 + options.length) % Math.max(1, options.length));
    } else if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      if (!query) return;
      event.preventDefault();
      pick(options[current]);
    } else if (event.key === 'Escape' && open && options.length) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box sx={{ position: 'relative' }}>
        <TextField
          fullWidth
          size="small"
          label={label}
          value={text}
          autoFocus={autoFocus}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={allowEmail ? t('Name oder E-Mail-Adresse') : t('Name oder Benutzername')}
          slotProps={{
            input: { startAdornment: <PersonAddAlt1Rounded sx={{ color: c.onSurfaceVariant, mr: 1, fontSize: 20 }} /> },
            htmlInput: { role: 'combobox', 'aria-expanded': open && options.length > 0, 'aria-autocomplete': 'list', autoComplete: 'off' },
          }}
        />
        {open && options.length > 0 && (
          <Paper
            role="listbox"
            elevation={4}
            sx={{
              position: 'absolute',
              zIndex: 20,
              left: 0,
              right: 0,
              top: 'calc(100% + 4px)',
              p: 0.5,
              borderRadius: `${radius.md}px`,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            {options.map((option, index) => (
              <ButtonBase
                key={option.email}
                role="option"
                aria-selected={index === current}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                onMouseMove={() => setActive(index)}
                sx={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  gap: 1.25,
                  px: 1,
                  py: 0.75,
                  borderRadius: `${radius.sm}px`,
                  bgcolor: index === current ? mix(c.onSurface, 8) : 'transparent',
                  textAlign: 'left',
                }}
              >
                {option.userId || option.contact ? (
                  <UserAvatar initials={option.initials} size={30} />
                ) : (
                  <Box
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: c.tertiaryContainer,
                      color: c.onTertiaryContainer,
                    }}
                  >
                    <AlternateEmailRounded sx={{ fontSize: 17 }} />
                  </Box>
                )}
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {option.name ?? t('Per E-Mail einladen')}
                  </Typography>
                  <Typography variant="caption" noWrap component="p" sx={{ color: c.onSurfaceVariant }}>
                    {/@users\.moe(cloud|calendar)\.invalid$/.test(option.email) ? t('Auf diesem Server') : option.email}
                  </Typography>
                </Box>
              </ButtonBase>
            ))}
          </Paper>
        )}
      </Box>
    </ClickAwayListener>
  );
}
