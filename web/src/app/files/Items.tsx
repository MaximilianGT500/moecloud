import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Checkbox from '@mui/material/Checkbox';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import { m } from 'motion/react';
import { formatBytes, formatDate, formatDay } from '../../lib/format';
import { t, tn, tp } from '../../lib/i18n';
import type { Prefs } from '../../lib/prefs';
import { c, curve, layer, mix, radius } from '../../theme/tokens';
import { FileIcon, Thumb, kindColor, type Item } from './kinds';
import { TagDots } from './tags';

export const DRAG_TYPE = 'application/x-moecloud-nodes';

export interface ItemsProps {
  items: Item[];
  layout: 'list' | 'grid';
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onOpen: (item: Item) => void;
  onMenu: (item: Item, anchor: HTMLElement | { x: number; y: number }) => void;
  onStar?: (item: Item) => void;
  onDropOnFolder?: (folder: Item, transfer: DataTransfer) => void;
  draggable?: boolean;
  column?: 'modified' | 'location' | 'owner' | 'trashed';
  sort?: Prefs['sort'];
  order?: Prefs['order'];
  onSort?: (sort: Prefs['sort']) => void;
  base?: string;
  label: string;
  menu?: { icon: ReactNode; label: string };
}

const coarse = () => window.matchMedia('(pointer: coarse)').matches;

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/);
  return (
    <Typography
      variant="caption"
      component="p"
      sx={{
        color: 'inherit',
        opacity: 0.85,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        mt: 0.25,
      }}
    >
      {parts.map((part, index) =>
        part.startsWith('\u0001') ? (
          <Box
            component="mark"
            key={index}
            sx={{ bgcolor: mix(c.tertiary, 28), color: 'inherit', borderRadius: '3px', px: '1px', fontWeight: 700 }}
          >
            {part.slice(1, -1)}
          </Box>
        ) : (
          part
        )
      )}
    </Typography>
  );
}

function Locked() {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        ml: 1,
        px: 0.75,
        borderRadius: `${radius.xs}px`,
        bgcolor: c.errorContainer,
        color: c.onErrorContainer,
        fontSize: '0.75rem',
        fontWeight: 700,
        verticalAlign: 'middle',
      }}
    >
      {t('Schadsoftware')}
    </Box>
  );
}

function detail(item: Item) {
  if (item.type === 'folder') return item.items === null ? '' : tn(item.items, '{count} Element', '{count} Elemente');
  return formatBytes(item.size);
}

function columnText(item: Item, column: ItemsProps['column']) {
  if (column === 'location') return item.location === '' ? t('Meine Dateien') : (item.location ?? '');
  if (column === 'owner') {
    const owner =
      item.viaGroup && item.owner
        ? t('{name} über {group}', { name: item.owner.name, group: item.viaGroup })
        : (item.owner?.name ?? t('Du'));
    return item.shareEnds ? `${owner} · ${t('bis {date}', { date: formatDay(item.shareEnds) })}` : owner;
  }
  if (column === 'trashed') return formatDate(item.trashedAt ?? item.modifiedAt);
  return formatDate(item.modifiedAt);
}

const columnTitle = (column: ItemsProps['column']) =>
  column === 'location' ? t('Ort') : column === 'owner' ? t('Gehört') : column === 'trashed' ? t('Gelöscht') : t('Geändert');

function Progress({ value }: { value: number }) {
  const percent = Math.round(value * 100);
  return (
    <Box
      role="progressbar"
      aria-label={t('Schon gesehen')}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      sx={{
        position: 'absolute',
        left: 8,
        right: 8,
        bottom: 8,
        height: 4,
        borderRadius: 2,
        bgcolor: mix(c.scrim, 55),
        overflow: 'hidden',
      }}
    >
      <Box sx={{ width: `${percent}%`, height: '100%', bgcolor: c.primary }} />
    </Box>
  );
}

export function Items(props: ItemsProps) {
  const { items, layout, selected, onSelect, onOpen, onMenu } = props;
  const anchor = useRef<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [over, setOver] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const selecting = selected.size > 0;

  const click = (event: MouseEvent, item: Item, index: number) => {
    setFocus(index);
    if (coarse() && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      if (selecting) {
        const next = new Set(selected);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        onSelect(next);
      } else onOpen(item);
      return;
    }
    if (event.shiftKey && anchor.current) {
      const from = items.findIndex((entry) => entry.id === anchor.current);
      const [start, end] = from < index ? [from, index] : [index, from];
      onSelect(new Set(items.slice(Math.max(0, start), end + 1).map((entry) => entry.id)));
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      onSelect(next);
    } else onSelect(new Set([item.id]));
    anchor.current = item.id;
  };

  const toggle = (item: Item) => {
    const next = new Set(selected);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    anchor.current = item.id;
    onSelect(next);
  };

  const context = (event: MouseEvent, item: Item, index: number) => {
    event.preventDefault();
    setFocus(index);
    if (coarse()) {
      toggle(item);
      return;
    }
    if (!selected.has(item.id)) onSelect(new Set([item.id]));
    onMenu(item, { x: event.clientX, y: event.clientY });
  };

  const moveFocus = (index: number) => {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setFocus(next);
    container.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
  };

  const keys = (event: KeyboardEvent, item: Item, index: number) => {
    const columns = layout === 'grid' ? Math.max(1, Math.floor((container.current?.clientWidth ?? 600) / 180)) : 1;
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(item);
    } else if (event.key === ' ') {
      event.preventDefault();
      toggle(item);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(index + columns);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(index - columns);
    } else if (event.key === 'ArrowRight' && layout === 'grid') {
      event.preventDefault();
      moveFocus(index + 1);
    } else if (event.key === 'ArrowLeft' && layout === 'grid') {
      event.preventDefault();
      moveFocus(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveFocus(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveFocus(items.length - 1);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      if (!selected.has(item.id)) onSelect(new Set([item.id]));
      onMenu(item, event.currentTarget as HTMLElement);
    }
  };

  const dragStart = (event: DragEvent, item: Item) => {
    if (!props.draggable) return;
    const ids = selected.has(item.id) ? [...selected] : [item.id];
    if (!selected.has(item.id)) onSelect(new Set([item.id]));
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    event.dataTransfer.effectAllowed = 'copyMove';
  };

  const dropProps = (item: Item) =>
    item.type === 'folder' && props.onDropOnFolder
      ? {
          onDragOver: (event: DragEvent) => {
            const types = [...event.dataTransfer.types];
            if (!types.includes(DRAG_TYPE) && !types.includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move';
            setOver(item.id);
          },
          onDragLeave: () => setOver((current) => (current === item.id ? null : current)),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            setOver(null);
            props.onDropOnFolder?.(item, event.dataTransfer);
          },
        }
      : {};

  const rowProps = (item: Item, index: number) => ({
    role: 'row',
    'data-index': index,
    'aria-selected': selected.has(item.id),
    tabIndex: index === Math.min(focus, items.length - 1) ? 0 : -1,
    draggable: props.draggable && item.role !== 'view',
    onClick: (event: MouseEvent) => click(event, item, index),
    onDoubleClick: () => onOpen(item),
    onContextMenu: (event: MouseEvent) => context(event, item, index),
    onKeyDown: (event: KeyboardEvent) => keys(event, item, index),
    onDragStart: (event: DragEvent) => dragStart(event, item),
    ...dropProps(item),
  });

  const surface = (item: Item) => {
    const active = selected.has(item.id);
    const target = over === item.id;
    return {
      bgcolor: target ? c.primaryContainer : active ? c.secondaryContainer : 'transparent',
      color: target ? c.onPrimaryContainer : active ? c.onSecondaryContainer : c.onSurface,
      outline: target ? `2px solid ${c.primary}` : 'none',
      outlineOffset: -2,
      transition: `background-color 140ms ${curve.standard}`,
      cursor: 'default',
      userSelect: 'none' as const,
      '&:hover': {
        bgcolor: target ? c.primaryContainer : active ? layer(c.secondaryContainer, c.onSecondaryContainer, 6) : mix(c.onSurface, 6),
      },
      '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: -2 },
    };
  };

  const actions = (item: Item, compact = false) => (
    <Box
      sx={{ display: 'flex', alignItems: 'center', flex: 'none' }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {compact && item.starred && <StarRounded sx={{ fontSize: 18, color: c.tertiary, mr: 0.25 }} aria-label={t('Favorit')} />}
      {!compact && props.onStar && item.trashedAt == null && (
        <Tooltip title={item.starred ? t('Aus Favoriten entfernen') : t('Zu Favoriten')}>
          <IconButton
            size="small"
            tabIndex={-1}
            aria-label={item.starred ? t('Aus Favoriten entfernen') : t('Zu Favoriten')}
            onClick={() => props.onStar?.(item)}
            sx={{
              color: item.starred ? c.tertiary : c.onSurfaceVariant,
              opacity: item.starred ? 1 : { xs: 0, md: 0 },
              '[role=row]:hover &, [role=row]:focus-within &': { opacity: 1 },
              display: { xs: item.starred ? 'inline-flex' : 'none', sm: 'inline-flex' },
            }}
          >
            {item.starred ? <StarRounded fontSize="small" /> : <StarOutlineRounded fontSize="small" />}
          </IconButton>
        </Tooltip>
      )}
      <IconButton
        size="small"
        tabIndex={-1}
        aria-label={props.menu ? `${props.menu.label}: ${item.name}` : t('Aktionen für {name}', { name: item.name })}
        onClick={(event) => onMenu(item, event.currentTarget)}
      >
        {props.menu?.icon ?? <MoreVertRounded fontSize="small" />}
      </IconButton>
    </Box>
  );

  if (layout === 'grid') {
    const folders = items.filter((item) => item.type === 'folder');
    const files = items.filter((item) => item.type === 'file');
    const indexOf = (item: Item) => items.indexOf(item);
    return (
      <Box
        ref={container}
        role="grid"
        aria-label={props.label}
        aria-multiselectable="true"
        sx={{ display: 'flex', flexDirection: 'column', gap: 3, p: { xs: 1.5, md: 2 } }}
      >
        {folders.length > 0 && (
          <GridGroup title={tp('Ordner')} min={220}>
            {folders.map((item) => (
              <Box
                key={item.id}
                {...rowProps(item, indexOf(item))}
                sx={{
                  ...surface(item),
                  bgcolor: selected.has(item.id) || over === item.id ? surface(item).bgcolor : c.surfaceContainer,
                  height: 56,
                  borderRadius: `${radius.md}px`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  pl: 2,
                  pr: 0.5,
                }}
              >
                <FileIcon item={item} />
                <Typography role="gridcell" variant="body2" noWrap sx={{ flex: 1, fontWeight: 500 }} title={item.name}>
                  {item.name}
                </Typography>
                <TagDots ids={item.tags} />
                {item.owner && (
                  <PeopleRounded
                    sx={{ fontSize: 18, color: c.onSurfaceVariant }}
                    aria-label={t('Geteilt von {name}', { name: item.owner.name })}
                  />
                )}
                {actions(item, true)}
              </Box>
            ))}
          </GridGroup>
        )}
        {files.length > 0 && (
          <GridGroup title={t('Dateien')} min={190}>
            {files.map((item) => (
              <Box
                key={item.id}
                {...rowProps(item, indexOf(item))}
                sx={{
                  ...surface(item),
                  bgcolor: selected.has(item.id) ? surface(item).bgcolor : c.surfaceContainer,
                  borderRadius: `${radius.md}px`,
                  p: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.75,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 0.75, minHeight: 36 }}>
                  <FileIcon item={item} size={20} />
                  <Typography role="gridcell" variant="body2" noWrap sx={{ flex: 1, fontWeight: 500 }} title={item.name}>
                    {item.name}
                    {item.infected && <Locked />}
                  </Typography>
                  <TagDots ids={item.tags} />
                  {actions(item, true)}
                </Box>
                <Box
                  sx={{
                    position: 'relative',
                    aspectRatio: '4 / 3',
                    borderRadius: `${radius.tile}px`,
                    overflow: 'hidden',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: item.thumb
                      ? c.surfaceContainerHighest
                      : `color-mix(in srgb, ${kindColor(item.kind)} 12%, ${c.surfaceContainerHigh})`,
                  }}
                >
                  <Thumb item={item} size="100%" base={props.base} />
                  {item.progress ? <Progress value={item.progress} /> : null}
                </Box>
              </Box>
            ))}
          </GridGroup>
        )}
      </Box>
    );
  }

  const column = props.column ?? 'modified';
  return (
    <Box
      ref={container}
      role="grid"
      aria-label={props.label}
      aria-multiselectable="true"
      aria-rowcount={items.length}
      sx={{ px: { xs: 0.5, md: 1 }, pb: 2 }}
    >
      <Box
        role="row"
        sx={{
          display: { xs: 'none', sm: 'grid' },
          gridTemplateColumns: { sm: '56px minmax(0, 1fr) 96px 96px', md: '56px minmax(0, 1fr) 180px 110px 96px' },
          alignItems: 'center',
          height: 44,
          px: 1,
          color: c.onSurfaceVariant,
          borderBottom: `1px solid ${c.outlineVariant}`,
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: { xs: c.surface, md: c.surfaceContainerLow },
        }}
      >
        <Box role="columnheader" sx={{ display: 'grid', placeItems: 'center' }}>
          <Checkbox
            size="small"
            checked={selected.size > 0 && selected.size === items.length}
            indeterminate={selected.size > 0 && selected.size < items.length}
            onChange={() => onSelect(selected.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
            slotProps={{ input: { 'aria-label': t('Alle auswählen') } }}
          />
        </Box>
        <SortHeader
          label={t('Name')}
          active={props.sort === 'name'}
          order={props.order}
          onClick={props.onSort && (() => props.onSort?.('name'))}
        />
        <Box role="columnheader" sx={{ display: { xs: 'none', md: 'block' } }}>
          {column === 'modified' ? (
            <SortHeader
              label={columnTitle(column)}
              active={props.sort === 'modified'}
              order={props.order}
              onClick={props.onSort && (() => props.onSort?.('modified'))}
            />
          ) : (
            <Typography variant="caption" sx={{ fontWeight: 500, fontSize: '0.8125rem' }}>
              {columnTitle(column)}
            </Typography>
          )}
        </Box>
        <SortHeader
          label={t('Größe')}
          active={props.sort === 'size'}
          order={props.order}
          onClick={props.onSort && (() => props.onSort?.('size'))}
        />
        <Box role="columnheader" />
      </Box>
      {items.map((item, index) => (
        <m.div key={item.id} initial={false} layout="position" transition={{ duration: 0.2 }}>
          <Box
            {...rowProps(item, index)}
            aria-rowindex={index + 1}
            sx={{
              ...surface(item),
              display: 'grid',
              gridTemplateColumns: {
                xs: '48px minmax(0, 1fr) auto',
                sm: '56px minmax(0, 1fr) 96px 96px',
                md: '56px minmax(0, 1fr) 180px 110px 96px',
              },
              alignItems: 'center',
              minHeight: 56,
              px: 1,
              borderRadius: `${radius.tile}px`,
              my: '2px',
            }}
          >
            <Box role="gridcell" sx={{ display: 'grid', placeItems: 'center', position: 'relative' }}>
              <Box
                sx={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 40,
                  height: 40,
                  '[role=row]:hover &, [aria-selected=true] &': { display: { sm: 'none' } },
                }}
              >
                {item.thumb ? <Thumb item={item} size={36} base={props.base} /> : <FileIcon item={item} />}
              </Box>
              <Checkbox
                size="small"
                checked={selected.has(item.id)}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                onChange={() => toggle(item)}
                slotProps={{ input: { 'aria-label': t('{name} auswählen', { name: item.name }) } }}
                sx={{ display: 'none', '[role=row]:hover &, [aria-selected=true] &': { display: { sm: 'inline-flex' } } }}
              />
            </Box>
            <Box role="gridcell" sx={{ minWidth: 0, pr: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500, minWidth: 0 }} title={item.name}>
                  {item.name}
                  {item.infected && <Locked />}
                </Typography>
                <TagDots ids={item.tags} />
              </Box>
              <Typography variant="caption" noWrap component="p" sx={{ color: 'inherit', opacity: 0.75, display: { sm: 'none' } }}>
                {[columnText(item, column), detail(item)].filter(Boolean).join(' · ')}
              </Typography>
              {item.snippet && <Snippet text={item.snippet} />}
            </Box>
            <Typography
              role="gridcell"
              variant="body2"
              noWrap
              sx={{ display: { xs: 'none', md: 'block' }, color: 'inherit', opacity: 0.8 }}
            >
              {columnText(item, column)}
            </Typography>
            <Typography
              role="gridcell"
              variant="body2"
              noWrap
              sx={{ display: { xs: 'none', sm: 'block' }, color: 'inherit', opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}
            >
              {detail(item)}
            </Typography>
            <Box role="gridcell" sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              {actions(item)}
            </Box>
          </Box>
        </m.div>
      ))}
    </Box>
  );
}

function SortHeader({ label, active, order, onClick }: { label: string; active: boolean; order?: Prefs['order']; onClick?: () => void }) {
  if (!onClick) {
    return (
      <Typography role="columnheader" variant="caption" sx={{ fontWeight: 500, fontSize: '0.8125rem' }}>
        {label}
      </Typography>
    );
  }
  return (
    <Box role="columnheader" aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <ButtonBase
        onClick={onClick}
        sx={{
          gap: 0.5,
          px: 1,
          py: 0.5,
          ml: -1,
          borderRadius: `${radius.sm}px`,
          fontSize: '0.8125rem',
          fontWeight: active ? 700 : 500,
          color: active ? c.onSurface : c.onSurfaceVariant,
          '&:hover': { bgcolor: mix(c.onSurface, 8) },
        }}
      >
        {label}
        {active && (order === 'asc' ? <ArrowUpwardRounded sx={{ fontSize: 16 }} /> : <ArrowDownwardRounded sx={{ fontSize: 16 }} />)}
      </ButtonBase>
    </Box>
  );
}

function GridGroup({ title, min, children }: { title: string; min: number; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle2" component="h2" sx={{ color: c.onSurfaceVariant, mb: 1.5, px: 0.5 }}>
        {title}
      </Typography>
      <Box role="rowgroup" sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 1.5 }}>
        {children}
      </Box>
    </Box>
  );
}
