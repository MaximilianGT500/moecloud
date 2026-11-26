import Box from '@mui/material/Box';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import NotificationsActiveRounded from '@mui/icons-material/NotificationsActiveRounded';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import GroupRounded from '@mui/icons-material/GroupRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import { emojiFor, startsWithEmoji } from '../../../../shared/emoji';
import { t } from '../../lib/i18n';
import type { CalendarPrefs, Occurrence } from './model';

export function ageOf(item: Occurrence) {
  if (item.kind !== 'birthday' || !item.birthYear) return null;
  const year = new Date(item.start).getUTCFullYear();
  const age = year - item.birthYear;
  return age > 0 && age < 150 ? age : null;
}

export function displayTitle(item: Occurrence, prefs: Pick<CalendarPrefs, 'emoji' | 'hideTitle'> | null) {
  if (item.busyOnly || (prefs?.hideTitle && !item.holiday)) return t('Beschäftigt');
  let title = item.title || t('(Ohne Titel)');
  const age = ageOf(item);
  if (age !== null) title = t('{title} ({age})', { title, age });
  if (prefs?.emoji && !startsWithEmoji(title)) {
    const emoji =
      item.kind === 'birthday'
        ? '🎂'
        : item.kind === 'focus'
          ? '🎯'
          : item.kind === 'ooo'
            ? '🏝️'
            : item.holiday
              ? '🎉'
              : emojiFor(item.title);
    if (emoji) title = `${emoji} ${title}`;
  }
  return title;
}

export function Badges({ item, size = 12 }: { item: Occurrence; size?: number }) {
  const icons = [];
  if (item.recurring) icons.push(<EventRepeatRounded key="repeat" aria-label={t('Wiederholt sich')} />);
  if (item.hasAlarms) icons.push(<NotificationsActiveRounded key="alarm" aria-label={t('Mit Erinnerung')} />);
  if (item.conference) icons.push(<VideocamRounded key="video" aria-label={t('Videokonferenz')} />);
  if (item.attendees > 0) icons.push(<GroupRounded key="people" aria-label={t('Mit Gästen')} />);
  if (item.privacy !== 'PUBLIC') icons.push(<LockRounded key="lock" aria-label={t('Privat')} />);
  if (!icons.length) return null;
  return (
    <Box component="span" sx={{ display: 'inline-flex', gap: 0.25, opacity: 0.75, verticalAlign: 'middle', '& svg': { fontSize: size } }}>
      {icons}
    </Box>
  );
}

export const isTentative = (item: Occurrence) =>
  item.status === 'TENTATIVE' || item.invitation === 'NEEDS-ACTION' || item.invitation === 'TENTATIVE';
export const isDeclined = (item: Occurrence) => item.invitation === 'DECLINED' || item.status === 'CANCELLED';
