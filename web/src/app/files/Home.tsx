import { Fragment, useEffect, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AlarmRounded from '@mui/icons-material/AlarmRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import FolderSharedRounded from '@mui/icons-material/FolderSharedRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDateTime, formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import type { Storage } from '../../lib/boot';
import { c, folderColor, mix, radius } from '../../theme/tokens';
import { ArrangeDialog, arrange, type Arrangement } from '../common/Arrange';
import { StorageMeter } from '../common/bits';
import { teamRoleLabel, type Team } from '../common/teams';
import { toast } from '../common/toast';
import { FileIcon, Thumb, type Item } from './kinds';
import { shownByFeature } from '../../lib/features';

interface Reminder {
  nodeId: string;
  name: string;
  type: 'file' | 'folder';
  dueAt: number;
  note: string | null;
  url: string;
}

interface Planning {
  events: {
    eventId: string;
    recurrenceId: string | null;
    title: string;
    location: string;
    start: number;
    end: number;
    allDay: boolean;
    startDate: string | null;
    color: string | null;
  }[];
  tasks: { id: string; title: string; due: number | null; allDay: boolean; priority: number; color: string | null }[];
  invitations: number;
}

const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

function whenText(start: number, allDay: boolean, startDate: string | null) {
  const date = allDay && startDate ? new Date(`${startDate}T00:00:00`) : new Date(start);
  const days = Math.round((dayStart(date) - dayStart(new Date())) / 86_400_000);
  const day =
    days === 0
      ? t('Heute')
      : days === 1
        ? t('Morgen')
        : new Intl.DateTimeFormat(document.documentElement.lang || undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(
            date
          );
  if (allDay) return day;
  return `${day}, ${new Intl.DateTimeFormat(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' }).format(date)}`;
}

function PlanRow({
  color,
  title,
  detail,
  onOpen,
  late = false,
}: {
  color: string | null;
  title: string;
  detail: string;
  onOpen: () => void;
  late?: boolean;
}) {
  return (
    <ButtonBase
      component="li"
      onClick={onOpen}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1.5,
        px: 1,
        py: 0.75,
        mx: -1,
        borderRadius: `${radius.tile}px`,
        textAlign: 'left',
        '&:hover': { bgcolor: mix(c.onSurface, 6) },
        '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: -2 },
      }}
    >
      <Box sx={{ width: 4, alignSelf: 'stretch', minHeight: 32, borderRadius: 2, bgcolor: color ?? c.primary, flex: 'none' }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            color: late ? c.error : c.onSurfaceVariant,
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {detail}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

interface HomeData {
  name: string;
  guest: boolean;
  recent: Item[];
  starred: Item[];
  shared: Item[];
  teams: Team[];
  reminders: Reminder[];
  memories: { year: number; items: Item[] }[];
  storage: Storage;
  layout?: Arrangement | null;
  planning?: Planning | null;
}

function greeting(name: string) {
  const hour = new Date().getHours();
  const first = name.trim().split(/\s+/)[0] || name;
  if (hour < 5) return t('Gute Nacht, {name}', { name: first });
  if (hour < 11) return t('Guten Morgen, {name}', { name: first });
  if (hour < 18) return t('Hallo, {name}', { name: first });
  return t('Guten Abend, {name}', { name: first });
}

function Card({
  title,
  more,
  children,
  wide = false,
}: {
  title: string;
  more?: { label: string; href: string };
  children: ReactNode;
  wide?: boolean;
}) {
  const id = `home-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Box
      component="section"
      aria-labelledby={id}
      sx={{
        bgcolor: c.surfaceContainerLow,
        borderRadius: `${radius.lg}px`,
        p: { xs: 2, sm: 2.5 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
        gridColumn: wide ? { md: '1 / -1' } : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 36 }}>
        <Typography id={id} variant="subtitle1" component="h2" sx={{ fontWeight: 700, flex: 1 }}>
          {title}
        </Typography>
        {more && (
          <Button
            size="small"
            endIcon={<ArrowForwardRounded />}
            href={more.href}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              navigate(more.href);
            }}
          >
            {more.label}
          </Button>
        )}
      </Box>
      {children}
    </Box>
  );
}

function ItemRow({ item, detail, onOpen }: { item: Item; detail: string; onOpen: (item: Item) => void }) {
  return (
    <ButtonBase
      component="li"
      onClick={() => onOpen(item)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1.5,
        px: 1,
        py: 0.75,
        mx: -1,
        borderRadius: `${radius.tile}px`,
        textAlign: 'left',
        '&:hover': { bgcolor: mix(c.onSurface, 6) },
        '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: -2 },
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: `${radius.sm}px`,
          overflow: 'hidden',
          flex: 'none',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {item.thumb ? <Thumb item={item} size={40} /> : <FileIcon item={item} size={28} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.name}
        </Typography>
        <Typography
          variant="caption"
          sx={{ color: c.onSurfaceVariant, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {detail}
        </Typography>
      </Box>
    </ButtonBase>
  );
}

const List = ({ children }: { children: ReactNode }) => (
  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column' }}>
    {children}
  </Box>
);

const Hint = ({ children }: { children: ReactNode }) => (
  <Typography variant="body2" sx={{ color: c.onSurfaceVariant, textWrap: 'pretty' }}>
    {children}
  </Typography>
);

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export function HomeView({ onOpen, onReveal }: { onOpen: (item: Item) => void; onReveal: (item: Item) => void }) {
  const [data, setData] = useState<HomeData | null>(null);
  const [arranging, setArranging] = useState(false);

  const load = () =>
    api
      .get<HomeData>(`/api/home?date=${today()}&offset=${new Date().getTimezoneOffset()}`)
      .then(setData)
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  useLive((event) => {
    if (event === 'reconnect' || event === 'shared' || event === 'events') void load();
  });

  if (!data) return null;
  const openFile = (item: Item) => (item.type === 'folder' ? onOpen(item) : onReveal(item));
  const changed = (item: Item) =>
    [
      item.updatedAt ? formatRelative(item.updatedAt) : formatRelative(item.modifiedAt),
      item.type === 'file' ? formatBytes(item.size) : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const cards: { key: string; label: string; available: boolean; node: ReactNode }[] = [
    {
      key: 'teams',
      label: t('Teamordner'),
      available: data.teams.length > 0,
      node: (
        <>
          {data.teams.length > 0 && (
            <Card title={t('Teamordner')} more={{ label: t('Alle'), href: '/files/teams' }} wide={data.guest}>
              <Box
                component="ul"
                sx={{
                  listStyle: 'none',
                  m: 0,
                  p: 0,
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
                }}
              >
                {data.teams.slice(0, 6).map((team) => (
                  <ButtonBase
                    component="li"
                    key={team.id}
                    onClick={() => navigate(`/files/folder/${team.rootId}`)}
                    sx={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: 1,
                      p: 1.5,
                      textAlign: 'left',
                      bgcolor: c.surfaceContainer,
                      borderRadius: `${radius.tile}px`,
                      '&:hover': { bgcolor: c.surfaceContainerHigh },
                      '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: -2 },
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <FolderSharedRounded sx={{ color: team.color ? folderColor(team.color) : c.primary }} />
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {team.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                          {teamRoleLabel(team.role)}
                        </Typography>
                      </Box>
                    </Box>
                    <StorageMeter storage={{ used: team.used, quota: team.quota }} compact />
                  </ButtonBase>
                ))}
              </Box>
            </Card>
          )}
        </>
      ),
    },
    {
      key: 'recent',
      label: t('Zuletzt bearbeitet'),
      available: !data.guest || data.recent.length > 0,
      node: (
        <>
          {(!data.guest || data.recent.length > 0) && (
            <Card title={t('Zuletzt bearbeitet')} more={data.guest ? undefined : { label: t('Alle'), href: '/files/recent' }}>
              {data.recent.length === 0 ? (
                <Hint>{t('Noch nichts. Lade etwas hoch, dann erscheint es hier.')}</Hint>
              ) : (
                <List>
                  {data.recent.slice(0, 6).map((item) => (
                    <ItemRow key={item.id} item={item} detail={changed(item)} onOpen={openFile} />
                  ))}
                </List>
              )}
            </Card>
          )}
        </>
      ),
    },
    {
      key: 'events',
      label: t('Nächste Termine'),
      available: Boolean(data.planning),
      node: data.planning ? (
        <Card title={t('Nächste Termine')} more={{ label: t('Kalender'), href: '/calendar' }}>
          {data.planning.invitations > 0 && (
            <Button size="small" sx={{ alignSelf: 'flex-start' }} onClick={() => navigate('/calendar')}>
              {tn(data.planning.invitations, 'Eine offene Einladung', '{count} offene Einladungen')}
            </Button>
          )}
          {data.planning.events.length > 0 ? (
            <List>
              {data.planning.events.map((event) => (
                <PlanRow
                  key={`${event.eventId}-${event.recurrenceId ?? ''}`}
                  color={event.color}
                  title={event.title || t('Ohne Titel')}
                  detail={[whenText(event.start, event.allDay, event.startDate), event.location].filter(Boolean).join(' · ')}
                  onOpen={() =>
                    (location.href = `/calendar?event=${encodeURIComponent(event.eventId)}${event.recurrenceId ? `&rid=${encodeURIComponent(event.recurrenceId)}` : ''}`)
                  }
                />
              ))}
            </List>
          ) : (
            <Hint>{t('In den nächsten zwei Wochen steht nichts an.')}</Hint>
          )}
        </Card>
      ) : null,
    },
    {
      key: 'starred',
      label: t('Favoriten'),
      available: true,
      node: (
        <>
          <Card title={t('Favoriten')} more={{ label: t('Alle'), href: '/files/starred' }}>
            {data.starred.length === 0 ? (
              <Hint>{t('Markier Dateien oder Ordner mit dem Stern, dann hast du sie hier griffbereit.')}</Hint>
            ) : (
              <List>
                {data.starred.slice(0, 6).map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    detail={item.type === 'folder' ? tn(item.items ?? 0, '{count} Element', '{count} Elemente') : changed(item)}
                    onOpen={openFile}
                  />
                ))}
              </List>
            )}
          </Card>
        </>
      ),
    },
    {
      key: 'tasks',
      label: t('Offene Aufgaben'),
      available: Boolean(data.planning),
      node: data.planning ? (
        <Card title={t('Offene Aufgaben')} more={{ label: t('Alle'), href: '/calendar/tasks' }}>
          {data.planning.tasks.length > 0 ? (
            <List>
              {data.planning.tasks.map((task) => (
                <PlanRow
                  key={task.id}
                  color={task.color}
                  title={task.title || t('Ohne Titel')}
                  detail={task.due ? whenText(task.due, task.allDay, null) : t('Ohne Fälligkeit')}
                  late={Boolean(task.due && task.due < Date.now())}
                  onOpen={() => (location.href = `/calendar/tasks?event=${encodeURIComponent(task.id)}`)}
                />
              ))}
            </List>
          ) : (
            <Hint>{t('Alles erledigt.')}</Hint>
          )}
        </Card>
      ) : null,
    },
    {
      key: 'shared',
      label: t('Mit dir geteilt'),
      available: true,
      node: (
        <>
          <Card title={t('Mit dir geteilt')} more={{ label: t('Alle'), href: '/files/shared' }}>
            {data.shared.length === 0 ? (
              <Hint>{t('Teilt jemand etwas mit dir, erscheint es hier.')}</Hint>
            ) : (
              <List>
                {data.shared.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    detail={[
                      item.owner?.name ? t('von {name}', { name: item.owner.name }) : null,
                      item.role === 'edit' ? t('Bearbeiten') : t('Lesen'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    onOpen={(entry) => (entry.type === 'folder' ? onOpen(entry) : navigate('/files/shared'))}
                  />
                ))}
              </List>
            )}
          </Card>
        </>
      ),
    },
    {
      key: 'reminders',
      label: t('Erinnerungen'),
      available: !data.guest,
      node: (
        <>
          {data.reminders.length > 0 && (
            <Card title={t('Erinnerungen')}>
              <List>
                {data.reminders.map((reminder) => (
                  <ButtonBase
                    component="li"
                    key={reminder.nodeId}
                    onClick={() => navigate(reminder.url)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      gap: 1.5,
                      px: 1,
                      py: 0.75,
                      mx: -1,
                      borderRadius: `${radius.tile}px`,
                      textAlign: 'left',
                      '&:hover': { bgcolor: mix(c.onSurface, 6) },
                      '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: -2 },
                    }}
                  >
                    <AlarmRounded sx={{ color: reminder.dueAt < Date.now() ? c.error : c.onSurfaceVariant, flex: 'none' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {reminder.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{
                          color: c.onSurfaceVariant,
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {[formatDateTime(reminder.dueAt), reminder.note].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </ButtonBase>
                ))}
              </List>
            </Card>
          )}
        </>
      ),
    },
    {
      key: 'memories',
      label: t('Fotos von früher'),
      available: !data.guest,
      node: (
        <>
          {data.memories.map((group) => (
            <Card
              key={group.year}
              title={tn(new Date().getFullYear() - group.year, 'Heute vor einem Jahr', 'Heute vor {count} Jahren')}
              more={{ label: t('Fotos'), href: '/files/photos' }}
            >
              <Box sx={{ display: 'grid', gap: 0.75, gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
                {group.items.map((item) => (
                  <ButtonBase
                    key={item.id}
                    aria-label={item.name}
                    onClick={() => onReveal(item)}
                    sx={{
                      aspectRatio: '1',
                      borderRadius: `${radius.sm}px`,
                      overflow: 'hidden',
                      bgcolor: c.surfaceContainerHigh,
                      '&:focus-visible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
                    }}
                  >
                    <Thumb item={item} size={120} />
                  </ButtonBase>
                ))}
              </Box>
            </Card>
          ))}
        </>
      ),
    },

    {
      key: 'storage',
      label: t('Speicher'),
      available: !data.guest,
      node: (
        <>
          {!data.guest && (
            <Card title={t('Speicher')} more={{ label: t('Ansehen'), href: '/files/storage' }}>
              <StorageMeter storage={data.storage} />
            </Card>
          )}
        </>
      ),
    },
  ];
  const layout = data.layout ?? null;
  const shown = arrange(
    cards.filter((card) => shownByFeature(card.key)),
    layout
  );

  return (
    <Box sx={{ px: { xs: 1.5, md: 3 }, pb: 4, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="p" sx={{ overflowWrap: 'anywhere' }}>
            {greeting(data.name)}
          </Typography>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant, mt: 0.5 }}>
            {data.guest
              ? t('Hier findest du, was andere mit dir geteilt haben.')
              : t('Hier siehst du, woran du zuletzt gearbeitet hast und was gerade ansteht.')}
          </Typography>
        </Box>
        <Tooltip title={t('Startseite anpassen')}>
          <IconButton aria-label={t('Startseite anpassen')} onClick={() => setArranging(true)}>
            <TuneRounded />
          </IconButton>
        </Tooltip>
      </Box>
      {arranging && (
        <ArrangeDialog
          title={t('Startseite anpassen')}
          text={t('Schieb die Bereiche in deine Reihenfolge und blende aus, was du nicht brauchst. Das gilt auf allen deinen Geräten.')}
          entries={cards.filter((card) => card.available && shownByFeature(card.key)).map((card) => ({ key: card.key, label: card.label }))}
          value={layout}
          onClose={() => setArranging(false)}
          onSave={async (home) => {
            try {
              await api.patch('/api/account/prefs', { home });
              setData({ ...data, layout: home });
              setArranging(false);
            } catch (error) {
              toast(errorText(error));
            }
          }}
        />
      )}
      {shown.length === 0 && <Hint>{t('Du hast alle Bereiche ausgeblendet. Über das Symbol oben rechts holst du sie zurück.')}</Hint>}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
        {shown.map((card) => (
          <Fragment key={card.key}>{card.node}</Fragment>
        ))}
      </Box>
    </Box>
  );
}
