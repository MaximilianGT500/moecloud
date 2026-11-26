import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import LinearProgress from '@mui/material/LinearProgress';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import HowToVoteRounded from '@mui/icons-material/HowToVoteRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import LockRounded from '@mui/icons-material/LockRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import { api, errorText } from '../../lib/api';
import { boot, type Boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { c, mix, radius } from '../../theme/tokens';
import { formatDayMedium, getZone } from '../calendar/dates';
import { ANSWER_COLOR, optionLabel, ResultsTable, type Poll } from '../calendar/PollTable';
import { PublicFrame } from './PublicFrame';

type Answer = 'yes' | 'maybe' | 'no';

interface PollBoot extends Boot {
  poll: Poll;
}

const STORAGE = 'moecloud-votes';

function storedVotes(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function PollPage() {
  const [poll, setPoll] = useState<Poll>(boot<PollBoot>().poll);
  const [edit, setEdit] = useState<string | null>(() => storedVotes()[poll.token] ?? null);
  const [name, setName] = useState(boot().user?.name ?? '');
  const [email, setEmail] = useState(boot().user?.email ?? '');
  const [comment, setComment] = useState('');
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!edit) return;
    api
      .get<{ vote: { name: string; email: string | null; answers: Record<string, Answer>; comment: string } }>(
        `/api/calendar/public/polls/${poll.token}/votes/${edit}`
      )
      .then((result) => {
        setName(result.vote.name);
        setEmail(result.vote.email ?? '');
        setComment(result.vote.comment);
        setAnswers(result.vote.answers);
      })
      .catch(() => setEdit(null));
  }, []);

  const cycle = (id: string) => {
    const order: Answer[] = poll.settings.maybe ? ['yes', 'maybe', 'no'] : ['yes', 'no'];
    const current = answers[id] ?? 'no';
    const next = answers[id] === undefined ? 'yes' : order[(order.indexOf(current) + 1) % order.length];
    setAnswers({ ...answers, [id]: next });
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const full = Object.fromEntries(poll.options.map((option) => [option.id, answers[option.id] ?? 'no']));
    const body = { name, email: email || null, answers: full, comment: comment || null };
    try {
      if (edit) {
        const result = await api.put<{ poll: Poll }>(`/api/calendar/public/polls/${poll.token}/votes/${edit}`, body);
        setPoll(result.poll);
      } else {
        const result = await api.post<{ editToken: string; poll: Poll }>(`/api/calendar/public/polls/${poll.token}/votes`, body);
        setPoll(result.poll);
        setEdit(result.editToken);
        try {
          localStorage.setItem(STORAGE, JSON.stringify({ ...storedVotes(), [poll.token]: result.editToken }));
        } catch {}
      }
      setSaved(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const final = poll.finalOption ? poll.options.find((option) => option.id === poll.finalOption) : null;
  return (
    <PublicFrame>
      <Box sx={{ maxWidth: 900, width: '100%', mx: 'auto', mt: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box
          sx={{
            p: { xs: 2.5, sm: 3.5 },
            borderRadius: `${radius.xl}px`,
            bgcolor: c.surfaceContainerLow,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Typography variant="overline" sx={{ color: c.primary, fontWeight: 800 }}>
            {t('Terminumfrage von {name}', { name: poll.owner })}
          </Typography>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 800 }}>
            {poll.title}
          </Typography>
          {poll.description && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{poll.description}</Typography>}
          {poll.location && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: c.onSurfaceVariant }}>
              <PlaceOutlined sx={{ fontSize: 20 }} />
              <Typography variant="body2">{poll.location}</Typography>
            </Box>
          )}
          <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
            {[
              t('Zeiten in {zone}', { zone: getZone().replace(/_/g, ' ') }),
              poll.deadline
                ? t('Abstimmen bis {date}', { date: formatDayMedium(new Date(poll.deadline).toISOString().slice(0, 10)) })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        </Box>

        {final && (
          <Alert severity="success" icon={<CheckCircleRounded />}>
            {t('Der Termin steht: {when}', { when: `${optionLabel(final).day}, ${optionLabel(final).time}` })}
          </Alert>
        )}

        {poll.closed ? (
          <Alert severity="info" icon={<LockRounded />}>
            {t('Die Abstimmung ist beendet.')}
          </Alert>
        ) : (
          <Box
            component="form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            sx={{
              p: { xs: 2, sm: 3 },
              borderRadius: `${radius.xl}px`,
              bgcolor: c.surfaceContainerLow,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {edit ? t('Deine Stimme ändern') : t('Wann kannst du?')}
            </Typography>
            <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
              {poll.settings.maybe
                ? t('Tippe auf einen Termin: einmal für Ja, zweimal für Vielleicht, dreimal für Nein.')
                : t('Tippe auf die Termine, an denen du kannst.')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 1 }}>
              {poll.options.map((option) => {
                const label = optionLabel(option);
                const answer = answers[option.id];
                const tally = poll.tally.find((entry) => entry.id === option.id);
                const full = poll.settings.limit > 0 && (tally?.yes ?? 0) >= poll.settings.limit && answer !== 'yes';
                return (
                  <ButtonBase
                    key={option.id}
                    disabled={full}
                    onClick={() => cycle(option.id)}
                    aria-label={`${label.day}, ${label.time}: ${answer === 'yes' ? t('Ja') : answer === 'maybe' ? t('Vielleicht') : t('Nein')}`}
                    sx={{
                      flexDirection: 'column',
                      p: 1.5,
                      gap: 0.5,
                      borderRadius: `${radius.lg}px`,
                      border: `2px solid ${answer ? ANSWER_COLOR[answer] : c.outlineVariant}`,
                      bgcolor: answer ? mix(ANSWER_COLOR[answer], 14) : c.surfaceContainerLowest,
                      opacity: full ? 0.5 : 1,
                      transition: 'all 140ms',
                    }}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {label.day}
                    </Typography>
                    <Typography variant="body2">{label.time}</Typography>
                    <Typography sx={{ fontWeight: 900, fontSize: 20, color: answer ? ANSWER_COLOR[answer] : c.onSurfaceVariant }}>
                      {answer === 'yes' ? '✓' : answer === 'maybe' ? '?' : answer === 'no' ? '✕' : '·'}
                    </Typography>
                    {full && <Typography variant="caption">{t('Ausgebucht')}</Typography>}
                  </ButtonBase>
                );
              })}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
              <TextField required label={t('Dein Name')} value={name} onChange={(event) => setName(event.target.value)} />
              {poll.settings.email && (
                <TextField
                  required
                  type="email"
                  label={t('E-Mail-Adresse')}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  helperText={t('Für die Einladung, sobald der Termin feststeht')}
                />
              )}
            </Box>
            <TextField
              label={t('Kommentar (optional)')}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              multiline
              minRows={2}
            />
            {error && <Alert severity="error">{error}</Alert>}
            {saved && <Alert severity="success">{t('Danke, deine Stimme ist gespeichert. Du kannst sie hier jederzeit ändern.')}</Alert>}
            {busy && <LinearProgress />}
            <Button
              type="submit"
              variant="contained"
              size="large"
              startIcon={<HowToVoteRounded />}
              disabled={busy || !name.trim()}
              sx={{ alignSelf: 'flex-start' }}
            >
              {edit ? t('Änderung speichern') : t('Abstimmen')}
            </Button>
          </Box>
        )}

        <Box sx={{ p: { xs: 2, sm: 3 }, borderRadius: `${radius.xl}px`, bgcolor: c.surfaceContainerLow }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
            {t('Bisherige Antworten')}
          </Typography>
          <ResultsTable poll={poll} />
        </Box>
      </Box>
    </PublicFrame>
  );
}
