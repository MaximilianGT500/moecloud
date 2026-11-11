import { useState, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import ListItemIcon from '@mui/material/ListItemIcon';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import SellRounded from '@mui/icons-material/SellRounded';
import StraightenRounded from '@mui/icons-material/StraightenRounded';
import { t, tp } from '../../lib/i18n';
import { setQuery } from '../../lib/router';
import { c, folderColor } from '../../theme/tokens';
import { DATE_FILTERS, SIZE_FILTERS, type View } from './model';
import { useTags } from './tags';

export const TYPE_FILTERS = [
  { value: '', label: tp('Alles') },
  { value: 'folder', label: tp('Ordner') },
  { value: 'image', label: tp('Bilder') },
  { value: 'video', label: tp('Videos') },
  { value: 'audio', label: tp('Audio') },
  { value: 'pdf', label: tp('PDFs') },
  { value: 'document', label: tp('Dokumente') },
];

type Kind = 'date' | 'size' | 'tag';

const selected = { bgcolor: c.secondaryContainer, color: c.onSecondaryContainer, borderColor: 'transparent' };

function MenuChip({
  label,
  icon,
  active,
  onOpen,
  onClear,
}: {
  label: string;
  icon: ReactElement;
  active: boolean;
  onOpen: (anchor: HTMLElement) => void;
  onClear: () => void;
}) {
  return (
    <Chip
      icon={icon}
      label={label}
      variant={active ? 'filled' : 'outlined'}
      onClick={(event) => onOpen(event.currentTarget)}
      onDelete={active ? onClear : (event) => onOpen((event.currentTarget as HTMLElement).closest('.MuiChip-root') as HTMLElement)}
      deleteIcon={active ? undefined : <ArrowDropDownRounded />}
      aria-haspopup="menu"
      sx={active ? selected : undefined}
    />
  );
}

export function SearchFilters({ view }: { view: Extract<View, { kind: 'search' }> }) {
  const tags = useTags();
  const [menu, setMenu] = useState<{ kind: Kind; anchor: HTMLElement } | null>(null);
  const date = DATE_FILTERS.find((entry) => entry.value === view.date);
  const size = SIZE_FILTERS.find((entry) => entry.value === view.size);
  const tag = tags.find((entry) => entry.id === view.tag);
  const choose = (key: Kind, value: string | null) => {
    setQuery(key, value);
    setMenu(null);
  };
  const options =
    menu?.kind === 'date'
      ? DATE_FILTERS.map((entry) => ({ value: entry.value, label: entry.label, color: null as string | null }))
      : menu?.kind === 'size'
        ? SIZE_FILTERS.map((entry) => ({ value: entry.value, label: entry.label, color: null as string | null }))
        : tags.map((entry) => ({ value: entry.id, label: entry.name, color: folderColor(entry.color) }));
  const current = menu?.kind === 'date' ? view.date : menu?.kind === 'size' ? view.size : view.tag;

  return (
    <Box
      role="group"
      aria-label={t('Filter')}
      sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', px: { xs: 1.5, md: 2 }, pb: 1.5 }}
    >
      {TYPE_FILTERS.map((filter) => (
        <Chip
          key={filter.value}
          label={filter.label}
          variant={view.filter === filter.value ? 'filled' : 'outlined'}
          icon={view.filter === filter.value ? <CheckRounded /> : undefined}
          onClick={() => setQuery('type', filter.value || null)}
          sx={view.filter === filter.value ? selected : undefined}
          aria-pressed={view.filter === filter.value}
        />
      ))}
      <Box aria-hidden sx={{ width: '1px', alignSelf: 'stretch', my: 0.5, mx: 0.5, bgcolor: c.outlineVariant }} />
      <MenuChip
        label={date ? date.label : t('Geändert')}
        icon={<EventRounded />}
        active={Boolean(date)}
        onOpen={(anchor) => setMenu({ kind: 'date', anchor })}
        onClear={() => choose('date', null)}
      />
      <MenuChip
        label={size ? size.label : t('Größe')}
        icon={<StraightenRounded />}
        active={Boolean(size)}
        onOpen={(anchor) => setMenu({ kind: 'size', anchor })}
        onClear={() => choose('size', null)}
      />
      {tags.length > 0 && (
        <MenuChip
          label={tag ? tag.name : t('Schlagwort')}
          icon={<SellRounded sx={tag ? { color: `${folderColor(tag.color)} !important` } : undefined} />}
          active={Boolean(tag)}
          onOpen={(anchor) => setMenu({ kind: 'tag', anchor })}
          onClear={() => choose('tag', null)}
        />
      )}
      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {options.map((option) => (
          <MenuItem key={option.value} selected={option.value === current} onClick={() => choose(menu!.kind, option.value)}>
            <ListItemIcon>
              {option.value === current ? (
                <CheckRounded />
              ) : option.color ? (
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: option.color, ml: 0.5 }} />
              ) : null}
            </ListItemIcon>
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
