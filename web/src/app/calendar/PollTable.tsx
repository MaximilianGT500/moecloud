import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EmojiEventsRounded from '@mui/icons-material/EmojiEventsRounded';
import { t, tn } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { formatDayMedium, formatTime, keyOf, weekdayShort } from './dates';

type Answer = 'yes' | 'maybe' | 'no';

export interface PollOption {
  id: string;
  start: number;
  end: number;
  allDay: boolean;
}

export interface Poll {
  id?: string;
  token: string;
  title: string;
  description: string;
  location: string;
  zone: string;
  options: PollOption[];
  settings: { maybe: boolean; hidden: boolean; email: boolean; limit: number };
  deadline: number | null;
  closed: boolean;
  finalOption: string | null;
  eventId: string | null;
  owner: string;
  votes: { id: string; name: string; email: string | null; answers: Record<string, Answer>; comment: string; createdAt: number }[];
  count: number;
  tally: { id: string; yes: number; maybe: number; score: number }[];
}

export const ANSWER_COLOR: Record<Answer, string> = { yes: '#22c55e', maybe: '#f59e0b', no: '#ef4444' };

export function optionLabel(option: PollOption) {
  if (option.allDay) return { day: formatDayMedium(new Date(option.start).toISOString().slice(0, 10)), time: t('Ganztägig') };
  return { day: formatDayMedium(keyOf(option.start)), time: `${formatTime(option.start)}–${formatTime(option.end)}` };
}

export function ResultsTable({
  poll,
  onRemoveVote,
  onFinalize,
}: {
  poll: Poll;
  onRemoveVote?: (id: string) => void;
  onFinalize?: (option: PollOption) => void;
}) {
  const best = Math.max(0, ...poll.tally.map((entry) => entry.score));
  return (
    <Box sx={{ overflowX: 'auto', borderRadius: `${radius.md}px`, border: `1px solid ${c.outlineVariant}` }}>
      <Box
        component="table"
        sx={{
          borderCollapse: 'collapse',
          minWidth: '100%',
          '& th, & td': {
            borderBottom: `1px solid ${c.outlineVariant}`,
            px: 1.25,
            py: 1,
            textAlign: 'center',
            fontSize: 14,
            whiteSpace: 'nowrap',
          },
          '& th:first-of-type, & td:first-of-type': {
            textAlign: 'left',
            position: 'sticky',
            left: 0,
            bgcolor: c.surfaceContainerLowest,
            zIndex: 1,
          },
        }}
      >
        <thead>
          <tr>
            <th>{tn(poll.count, '1 Stimme', '{count} Stimmen')}</th>
            {poll.options.map((option) => {
              const label = optionLabel(option);
              const tally = poll.tally.find((entry) => entry.id === option.id);
              const top = tally && best > 0 && tally.score === best;
              const final = poll.finalOption === option.id;
              return (
                <Box
                  component="th"
                  key={option.id}
                  sx={{ bgcolor: final ? mix(c.primary, 18) : top ? mix('#22c55e', 10) : undefined, verticalAlign: 'top' }}
                >
                  <Typography variant="caption" component="div" sx={{ color: c.onSurfaceVariant }}>
                    {weekdayShort(option.allDay ? new Date(option.start).toISOString().slice(0, 10) : keyOf(option.start))}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {label.day.replace(/^\S+\s/, '')}
                  </Typography>
                  <Typography variant="caption" component="div">
                    {label.time}
                  </Typography>
                  {tally && (
                    <Typography variant="caption" component="div" sx={{ fontWeight: 700, mt: 0.5 }}>
                      {top && <EmojiEventsRounded sx={{ fontSize: 14, verticalAlign: 'middle', color: '#f59e0b', mr: 0.25 }} />}✓{' '}
                      {tally.yes}
                      {poll.settings.maybe ? ` · ? ${tally.maybe}` : ''}
                    </Typography>
                  )}
                  {onFinalize && !poll.finalOption && (
                    <Button size="small" onClick={() => onFinalize(option)} sx={{ mt: 0.5, minWidth: 0, px: 1 }}>
                      {t('Festlegen')}
                    </Button>
                  )}
                  {final && <Chip size="small" color="primary" label={t('Festgelegt')} sx={{ mt: 0.5 }} />}
                </Box>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {poll.votes.map((vote) => (
            <tr key={vote.id}>
              <td>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {vote.name}
                    </Typography>
                    {vote.comment && (
                      <Typography
                        variant="caption"
                        sx={{ color: c.onSurfaceVariant, display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {vote.comment}
                      </Typography>
                    )}
                  </Box>
                  {onRemoveVote && (
                    <IconButton
                      size="small"
                      aria-label={t('Stimme von {name} löschen', { name: vote.name })}
                      onClick={() => onRemoveVote(vote.id)}
                    >
                      <CloseRounded sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                </Box>
              </td>
              {poll.options.map((option) => {
                const answer = vote.answers[option.id] ?? 'no';
                return (
                  <Box
                    component="td"
                    key={option.id}
                    sx={{ bgcolor: mix(ANSWER_COLOR[answer], answer === 'no' ? 6 : 16) }}
                    aria-label={answer === 'yes' ? t('Ja') : answer === 'maybe' ? t('Vielleicht') : t('Nein')}
                  >
                    <Box component="span" sx={{ fontWeight: 800, color: ANSWER_COLOR[answer] }}>
                      {answer === 'yes' ? '✓' : answer === 'maybe' ? '?' : '–'}
                    </Box>
                  </Box>
                );
              })}
            </tr>
          ))}
          {poll.votes.length === 0 && (
            <tr>
              <td colSpan={poll.options.length + 1}>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, py: 1 }}>
                  {poll.settings.hidden && !onRemoveVote
                    ? t('Die Ergebnisse sieht nur die Person, die gefragt hat.')
                    : t('Noch keine Stimmen.')}
                </Typography>
              </td>
            </tr>
          )}
        </tbody>
      </Box>
    </Box>
  );
}
