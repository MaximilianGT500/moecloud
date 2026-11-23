import { useEffect, useRef, useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import AlternateEmailRounded from '@mui/icons-material/AlternateEmailRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import AssignmentRounded from '@mui/icons-material/AssignmentRounded';
import AutorenewRounded from '@mui/icons-material/AutorenewRounded';
import CheckBoxOutlineBlankRounded from '@mui/icons-material/CheckBoxOutlineBlankRounded';
import CheckBoxRounded from '@mui/icons-material/CheckBoxRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import InsertChartOutlinedRounded from '@mui/icons-material/InsertChartOutlinedRounded';
import LinearScaleRounded from '@mui/icons-material/LinearScaleRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import NumbersRounded from '@mui/icons-material/NumbersRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded';
import RadioButtonCheckedRounded from '@mui/icons-material/RadioButtonCheckedRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import ShortTextRounded from '@mui/icons-material/ShortTextRounded';
import SubjectRounded from '@mui/icons-material/SubjectRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { useLive } from '../../lib/live';
import { navigate } from '../../lib/router';
import { c, radius } from '../../theme/tokens';
import { CopyField, EmptyState, QrCode, Section, copyText } from '../common/bits';
import { confirm, prompt } from '../common/dialogs';
import { toast } from '../common/toast';

type Kind = 'text' | 'longtext' | 'email' | 'number' | 'date' | 'single' | 'multiple' | 'scale';
type State = 'open' | 'closed' | 'ended' | 'full';

interface Choice {
  id: string;
  label: string;
}

interface Question {
  id: string;
  kind: Kind;
  title: string;
  description: string;
  required: boolean;
  options: Choice[];
  min: number | null;
  max: number | null;
  low: string;
  high: string;
}

interface Form {
  id: string;
  title: string;
  description: string;
  questions: Question[];
  accepting: boolean;
  closesAt: number | null;
  maxResponses: number | null;
  once: boolean;
  signedIn: boolean;
  named: boolean;
  notify: boolean;
  confirmation: string;
  url: string;
  responses: number;
  state: State;
  createdAt: number;
  updatedAt: number;
}

interface Summary {
  id: string;
  kind: Kind;
  title: string;
  answered: number;
  options?: { id: string; label: string; count: number }[];
  average?: number | null;
  min?: number | null;
  max?: number | null;
  low?: string;
  high?: string;
  latest?: string[];
}

interface Results {
  total: number;
  questions: Summary[];
}

interface ResponseItem {
  id: string;
  createdAt: number;
  person: { id: number; name: string; username: string } | null;
  answers: { question: string; value: unknown; text: string }[];
}

const KINDS: { kind: Kind; label: () => string; hint: () => string; icon: ReactNode }[] = [
  { kind: 'text', label: () => t('Kurze Antwort'), hint: () => t('Eine Zeile, bis 1000 Zeichen'), icon: <ShortTextRounded /> },
  { kind: 'longtext', label: () => t('Lange Antwort'), hint: () => t('Mehrere Zeilen, bis 4000 Zeichen'), icon: <SubjectRounded /> },
  { kind: 'single', label: () => t('Eine Auswahl'), hint: () => t('Genau eine der Antworten'), icon: <RadioButtonCheckedRounded /> },
  { kind: 'multiple', label: () => t('Mehrere Auswahlen'), hint: () => t('Beliebig viele der Antworten'), icon: <CheckBoxRounded /> },
  { kind: 'scale', label: () => t('Skala'), hint: () => t('Eine Zahl auf einer Skala'), icon: <LinearScaleRounded /> },
  { kind: 'number', label: () => t('Zahl'), hint: () => t('Auch mit Komma'), icon: <NumbersRounded /> },
  { kind: 'date', label: () => t('Datum'), hint: () => t('Tag, Monat und Jahr'), icon: <EventRounded /> },
  {
    kind: 'email',
    label: () => t('E-Mail-Adresse'),
    hint: () => t('MoeCloud prüft, ob es eine Adresse ist'),
    icon: <AlternateEmailRounded />,
  },
];

const kindOf = (kind: Kind) => KINDS.find((entry) => entry.kind === kind)!;

const newId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
};

const choices = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: newId(), label: t('Antwort {count}', { count: index + 1 }) }));

function blank(kind: Kind): Question {
  return {
    id: newId(),
    kind,
    title: '',
    description: '',
    required: false,
    options: kind === 'single' || kind === 'multiple' ? choices(2) : [],
    min: kind === 'scale' ? 1 : null,
    max: kind === 'scale' ? 5 : null,
    low: '',
    high: '',
  };
}

function switchKind(question: Question, kind: Kind): Question {
  const fresh = blank(kind);
  const keepOptions = (kind === 'single' || kind === 'multiple') && question.options.length > 0;
  return { ...question, kind, options: keepOptions ? question.options : fresh.options, min: fresh.min, max: fresh.max, low: '', high: '' };
}

const fullUrl = (form: Pick<Form, 'url'>) => `${location.origin}${form.url}`;

function stateLabel(state: State) {
  switch (state) {
    case 'open':
      return t('Nimmt Antworten an');
    case 'closed':
      return t('Geschlossen');
    case 'ended':
      return t('Frist vorbei');
    case 'full':
      return t('Genug Antworten');
  }
}

function StateChip({ state }: { state: State }) {
  return (
    <Chip
      size="small"
      label={stateLabel(state)}
      color={state === 'open' ? 'success' : 'default'}
      variant={state === 'open' ? 'filled' : 'outlined'}
      data-form-state={state}
    />
  );
}

async function createForm() {
  const title = await prompt({ title: t('Neues Formular'), label: t('Titel'), value: '', confirm: t('Anlegen') });
  if (!title?.trim()) return;
  try {
    const { form } = await api.post<{ form: Form }>('/api/forms', { title: title.trim() });
    navigate(`/files/forms/${form.id}`);
  } catch (error) {
    toast(errorText(error));
  }
}

async function removeForm(form: Pick<Form, 'id' | 'title' | 'responses'>) {
  const ok = await confirm({
    title: t('„{title}“ löschen?', { title: form.title }),
    text: form.responses
      ? tn(form.responses, 'Die eine Antwort geht mit verloren.', 'Die {count} Antworten gehen mit verloren.')
      : t('Der Link funktioniert danach nicht mehr.'),
    confirm: t('Löschen'),
    danger: true,
  });
  if (!ok) return false;
  try {
    await api.delete(`/api/forms/${form.id}`);
    toast(t('Formular gelöscht'));
    return true;
  } catch (error) {
    toast(errorText(error));
    return false;
  }
}

async function duplicate(form: Pick<Form, 'id'>) {
  try {
    const { form: copy } = await api.post<{ form: Form }>(`/api/forms/${form.id}/copy`);
    navigate(`/files/forms/${copy.id}`);
  } catch (error) {
    toast(errorText(error));
  }
}

function FormMenu({ form, onDeleted }: { form: Form; onDeleted: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const entries: { label: string; icon: ReactNode; run: () => void | Promise<void>; danger?: boolean }[] = [
    { label: t('Link kopieren'), icon: <LinkRounded />, run: () => void copyText(fullUrl(form), t('Link kopiert')) },
    { label: t('Ansehen wie Besucher'), icon: <OpenInNewRounded />, run: () => void window.open(form.url, '_blank', 'noopener') },
    { label: t('Kopie anlegen'), icon: <ContentCopyRounded />, run: () => void duplicate(form) },
    {
      label: t('Formular löschen'),
      icon: <DeleteOutlineRounded />,
      danger: true,
      run: async () => {
        if (await removeForm(form)) onDeleted();
      },
    },
  ];
  return (
    <>
      <Tooltip title={t('Weitere Aktionen')}>
        <IconButton aria-label={t('Weitere Aktionen')} onClick={(event) => setAnchor(event.currentTarget)}>
          <MoreVertRounded />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {entries.map((entry) => (
          <MenuItem
            key={entry.label}
            onClick={() => {
              setAnchor(null);
              void entry.run();
            }}
            sx={entry.danger ? { color: c.error } : undefined}
          >
            <ListItemIcon sx={entry.danger ? { color: c.error } : undefined}>{entry.icon}</ListItemIcon>
            <ListItemText>{entry.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function FormList() {
  const [forms, setForms] = useState<Form[] | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ items: Form[] }>('/api/forms', abort.signal)
      .then((data) => setForms(data.items))
      .catch((error) => {
        if (abort.signal.aborted) return;
        setForms((current) => current ?? []);
        toast(errorText(error));
      });
    return () => abort.abort();
  }, [revision]);

  useLive((event) => {
    if (event === 'forms' || event === 'reconnect') setRevision((value) => value + 1);
  });

  if (!forms) {
    return (
      <Box sx={{ px: { xs: 1.5, md: 2 }, display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} variant="rounded" height={132} />
        ))}
      </Box>
    );
  }

  const add = (
    <Button variant="contained" startIcon={<AddRounded />} onClick={() => void createForm()}>
      {t('Neues Formular')}
    </Button>
  );

  if (!forms.length) {
    return (
      <EmptyState
        icon={<AssignmentRounded />}
        title={t('Noch keine Formulare')}
        text={t(
          'Ein Formular sammelt Antworten über einen Link, für Umfragen, Anmeldungen oder Rückmeldungen. Wer antwortet, braucht kein Konto.'
        )}
        action={add}
      />
    );
  }

  return (
    <Box sx={{ px: { xs: 1.5, md: 2 }, pb: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant, flex: '1 1 240px' }}>
          {t('Umfragen, Anmeldungen und Rückmeldungen per Link. Wer antwortet, braucht kein Konto.')}
        </Typography>
        {add}
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {forms.map((form) => (
          <Box
            key={form.id}
            data-form={form.id}
            sx={{ position: 'relative', bgcolor: c.surfaceContainer, borderRadius: `${radius.lg}px`, overflow: 'hidden' }}
          >
            <ButtonBase
              onClick={() => navigate(`/files/forms/${form.id}`)}
              sx={{
                width: '100%',
                p: 2.5,
                pr: 6,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 1,
                textAlign: 'left',
              }}
            >
              <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                {form.title}
              </Typography>
              <StateChip state={form.state} />
              <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
                {tn(form.responses, '{count} Antwort', '{count} Antworten')} ·{' '}
                {t('geändert {time}', { time: formatRelative(form.updatedAt) })}
              </Typography>
            </ButtonBase>
            <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
              <FormMenu form={form} onDeleted={() => setRevision((value) => value + 1)} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

const card = {
  bgcolor: c.surfaceContainer,
  borderRadius: `${radius.lg}px`,
  p: { xs: 2, sm: 2.5 },
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
} as const;

function ChoiceEditor({ question, onChange }: { question: Question; onChange: (question: Question) => void }) {
  const refs = useRef(new Map<string, HTMLInputElement>());
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    refs.current.get(focus)?.focus();
    setFocus(null);
  }, [focus]);
  const add = (after?: number) => {
    const choice = { id: newId(), label: '' };
    const options = [...question.options];
    options.splice(after === undefined ? options.length : after + 1, 0, choice);
    onChange({ ...question, options });
    setFocus(choice.id);
  };
  const Icon = question.kind === 'single' ? RadioButtonUncheckedRounded : CheckBoxOutlineBlankRounded;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {question.options.map((choice, index) => (
        <Box key={choice.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Icon sx={{ color: c.onSurfaceVariant }} />
          <TextField
            size="small"
            fullWidth
            value={choice.label}
            placeholder={t('Antwort {count}', { count: index + 1 })}
            inputRef={(element: HTMLInputElement | null) => {
              if (element) refs.current.set(choice.id, element);
              else refs.current.delete(choice.id);
            }}
            onChange={(event) =>
              onChange({
                ...question,
                options: question.options.map((entry) =>
                  entry.id === choice.id ? { ...entry, label: event.target.value.slice(0, 200) } : entry
                ),
              })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (question.options.length < 50) add(index);
              }
            }}
            slotProps={{ htmlInput: { 'aria-label': t('Antwort {count}', { count: index + 1 }), maxLength: 200 } }}
          />
          <Tooltip title={t('Antwort entfernen')}>
            <span>
              <IconButton
                aria-label={t('Antwort entfernen')}
                disabled={question.options.length <= 1}
                onClick={() => onChange({ ...question, options: question.options.filter((entry) => entry.id !== choice.id) })}
              >
                <CloseRounded />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      ))}
      <Button sx={{ alignSelf: 'flex-start' }} startIcon={<AddRounded />} disabled={question.options.length >= 50} onClick={() => add()}>
        {t('Antwort hinzufügen')}
      </Button>
    </Box>
  );
}

function ScaleEditor({ question, onChange }: { question: Question; onChange: (question: Question) => void }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: '100px 100px 1fr 1fr' } }}>
      <TextField
        select
        size="small"
        label={t('Von')}
        value={question.min ?? 1}
        onChange={(event) => onChange({ ...question, min: Number(event.target.value) })}
      >
        {[0, 1].map((value) => (
          <MenuItem key={value} value={value}>
            {value}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label={t('Bis')}
        value={question.max ?? 5}
        onChange={(event) => onChange({ ...question, max: Number(event.target.value) })}
      >
        {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
          <MenuItem key={value} value={value}>
            {value}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        size="small"
        label={t('Text am Anfang')}
        placeholder={t('etwa „Gar nicht“')}
        value={question.low}
        onChange={(event) => onChange({ ...question, low: event.target.value.slice(0, 60) })}
      />
      <TextField
        size="small"
        label={t('Text am Ende')}
        placeholder={t('etwa „Sehr“')}
        value={question.high}
        onChange={(event) => onChange({ ...question, high: event.target.value.slice(0, 60) })}
      />
    </Box>
  );
}

function NumberEditor({ question, onChange }: { question: Question; onChange: (question: Question) => void }) {
  const field = (key: 'min' | 'max', label: string) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={question[key] ?? ''}
      onChange={(event) => {
        const raw = event.target.value;
        const value = raw === '' ? null : Math.trunc(Number(raw));
        onChange({ ...question, [key]: value === null || Number.isFinite(value) ? value : null });
      }}
      helperText={t('Freiwillig')}
    />
  );
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: '160px 160px' } }}>
      {field('min', t('Kleinster Wert'))}
      {field('max', t('Größter Wert'))}
    </Box>
  );
}

function QuestionCard({
  question,
  index,
  total,
  autoFocus,
  onChange,
  onMove,
  onCopy,
  onDelete,
}: {
  question: Question;
  index: number;
  total: number;
  autoFocus: boolean;
  onChange: (question: Question) => void;
  onMove: (step: number) => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const kind = kindOf(question.kind);
  return (
    <Box component="section" sx={card} data-question-card={question.id} aria-label={t('Frage {count}', { count: index + 1 })}>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <TextField
          label={t('Frage {count}', { count: index + 1 })}
          value={question.title}
          autoFocus={autoFocus}
          multiline
          onChange={(event) => onChange({ ...question, title: event.target.value.replace(/\n/g, ' ').slice(0, 500) })}
          sx={{ flex: '1 1 300px' }}
        />
        <TextField
          select
          label={t('Art')}
          value={question.kind}
          onChange={(event) => onChange(switchKind(question, event.target.value as Kind))}
          sx={{ flex: '0 1 220px', minWidth: 180 }}
          slotProps={{ select: { renderValue: (value) => kindOf(value as Kind).label() } }}
        >
          {KINDS.map((entry) => (
            <MenuItem key={entry.kind} value={entry.kind}>
              <ListItemIcon>{entry.icon}</ListItemIcon>
              <ListItemText primary={entry.label()} secondary={entry.hint()} />
            </MenuItem>
          ))}
        </TextField>
      </Box>
      <TextField
        size="small"
        label={t('Hinweis unter der Frage')}
        value={question.description}
        multiline
        onChange={(event) => onChange({ ...question, description: event.target.value.slice(0, 2000) })}
      />
      {(question.kind === 'single' || question.kind === 'multiple') && <ChoiceEditor question={question} onChange={onChange} />}
      {question.kind === 'scale' && <ScaleEditor question={question} onChange={onChange} />}
      {question.kind === 'number' && <NumberEditor question={question} onChange={onChange} />}
      {question.kind !== 'single' && question.kind !== 'multiple' && question.kind !== 'scale' && question.kind !== 'number' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: c.onSurfaceVariant }}>
          {kind.icon}
          <Typography variant="body2">{kind.hint()}</Typography>
        </Box>
      )}
      <Divider />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <FormControlLabel
          sx={{ m: 0, gap: 1 }}
          control={<Switch checked={question.required} onChange={(event) => onChange({ ...question, required: event.target.checked })} />}
          label={t('Pflichtfrage')}
        />
        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('Nach oben')}>
          <span>
            <IconButton aria-label={t('Nach oben')} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUpwardRounded />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('Nach unten')}>
          <span>
            <IconButton aria-label={t('Nach unten')} disabled={index === total - 1} onClick={() => onMove(1)}>
              <ArrowDownwardRounded />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('Frage kopieren')}>
          <span>
            <IconButton aria-label={t('Frage kopieren')} disabled={total >= 100} onClick={onCopy}>
              <ContentCopyRounded />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('Frage löschen')}>
          <IconButton aria-label={t('Frage löschen')} onClick={onDelete} sx={{ color: c.error }}>
            <DeleteOutlineRounded />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}

interface Draft {
  title: string;
  description: string;
  questions: Question[];
}

function QuestionsTab({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const update = (questions: Question[]) => onChange({ ...draft, questions });
  const add = (kind: Kind) => {
    const question = blank(kind);
    setFresh(question.id);
    update([...draft.questions, question]);
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={card}>
        <TextField
          label={t('Titel')}
          value={draft.title}
          required
          error={!draft.title.trim()}
          helperText={!draft.title.trim() ? t('Ohne Titel speichert MoeCloud den bisherigen') : undefined}
          onChange={(event) => onChange({ ...draft, title: event.target.value.replace(/\n/g, ' ').slice(0, 200) })}
          slotProps={{ htmlInput: { style: { fontSize: '1.25rem', fontWeight: 700 } } }}
        />
        <TextField
          label={t('Beschreibung')}
          placeholder={t('Worum geht es, bis wann, was passiert mit den Antworten?')}
          value={draft.description}
          multiline
          minRows={2}
          onChange={(event) => onChange({ ...draft, description: event.target.value.slice(0, 4000) })}
        />
      </Box>
      {draft.questions.map((question, index) => (
        <QuestionCard
          key={question.id}
          question={question}
          index={index}
          total={draft.questions.length}
          autoFocus={question.id === fresh}
          onChange={(next) => update(draft.questions.map((entry) => (entry.id === question.id ? next : entry)))}
          onMove={(step) => {
            const list = [...draft.questions];
            const [moved] = list.splice(index, 1);
            list.splice(index + step, 0, moved);
            update(list);
          }}
          onCopy={() => {
            const copy = { ...question, id: newId(), options: question.options.map((choice) => ({ ...choice, id: newId() })) };
            const list = [...draft.questions];
            list.splice(index + 1, 0, copy);
            update(list);
          }}
          onDelete={() => update(draft.questions.filter((entry) => entry.id !== question.id))}
        />
      ))}
      {draft.questions.length === 0 && (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant, textAlign: 'center', py: 2 }}>
          {t('Noch keine Fragen. Leg unten die erste an.')}
        </Typography>
      )}
      <Button
        variant="outlined"
        startIcon={<AddRounded />}
        disabled={draft.questions.length >= 100}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ alignSelf: 'center' }}
      >
        {t('Frage hinzufügen')}
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {KINDS.map((entry) => (
          <MenuItem
            key={entry.kind}
            onClick={() => {
              setAnchor(null);
              add(entry.kind);
            }}
          >
            <ListItemIcon>{entry.icon}</ListItemIcon>
            <ListItemText primary={entry.label()} secondary={entry.hint()} />
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}

function Bars({ options, total }: { options: { id: string; label: string; count: number }[]; total: number }) {
  return (
    <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {options.map((entry) => {
        const share = total ? Math.round((entry.count / total) * 100) : 0;
        return (
          <Tooltip
            key={entry.id}
            title={t('{label}: {count} von {total}, {share} %', { label: entry.label, count: entry.count, total, share })}
            placement="top-start"
          >
            <Box component="li" data-bar={entry.label} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {entry.label}
                </Typography>
                <Typography variant="body2" sx={{ color: c.onSurfaceVariant, fontVariantNumeric: 'tabular-nums' }}>
                  {formatNumber(entry.count)} · {share} %
                </Typography>
              </Box>
              <Box sx={{ height: 8, borderRadius: '4px', bgcolor: c.surfaceContainerHighest, overflow: 'hidden' }}>
                <Box
                  sx={{ height: '100%', width: `${total ? (entry.count / total) * 100 : 0}%`, bgcolor: c.primary, borderRadius: '4px' }}
                />
              </Box>
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ flex: '1 1 120px', p: 1.5, borderRadius: `${radius.md}px`, bgcolor: c.surfaceContainerHigh }}>
      <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
        {label}
      </Typography>
      <Typography variant="h6" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

const decimal = (value: number | null | undefined) =>
  value === null || value === undefined ? '–' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

function SummaryCard({ summary, total }: { summary: Summary; total: number }) {
  return (
    <Box sx={card} data-summary={summary.id}>
      <Box>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
          {summary.title || t('Frage ohne Titel')}
        </Typography>
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('{count} von {total} haben geantwortet', { count: summary.answered, total })}
        </Typography>
      </Box>
      {summary.options && <Bars options={summary.options} total={summary.answered} />}
      {summary.kind === 'scale' && summary.average !== null && (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Durchschnitt {value}', { value: decimal(summary.average) })}
          {summary.low || summary.high ? ` · ${[summary.low, summary.high].filter(Boolean).join(' … ')}` : ''}
        </Typography>
      )}
      {summary.kind === 'number' && (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Stat label={t('Durchschnitt')} value={decimal(summary.average)} />
          <Stat label={t('Kleinster Wert')} value={decimal(summary.min)} />
          <Stat label={t('Größter Wert')} value={decimal(summary.max)} />
        </Box>
      )}
      {summary.latest && summary.latest.length > 0 && (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {summary.latest.map((text, index) => (
            <Box
              component="li"
              key={index}
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: `${radius.md}px`,
                bgcolor: c.surfaceContainerHigh,
                whiteSpace: 'pre-line',
                overflowWrap: 'anywhere',
              }}
            >
              <Typography variant="body2">{text}</Typography>
            </Box>
          ))}
          {summary.answered > summary.latest.length && (
            <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
              {t('Die neuesten {count}. Alle stehen unten bei den einzelnen Antworten und in der CSV-Datei.', {
                count: summary.latest.length,
              })}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}

function AnswersTab({ form, revision }: { form: Form; revision: number }) {
  const [results, setResults] = useState<Results | null>(null);
  const [items, setItems] = useState<ResponseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (keep = 0) => {
    try {
      const [summary, page] = await Promise.all([
        api.get<Results>(`/api/forms/${form.id}/results`),
        api.get<{ total: number; items: ResponseItem[] }>(`/api/forms/${form.id}/responses?limit=${Math.max(20, keep)}`),
      ]);
      setResults(summary);
      setItems(page.items);
      setTotal(page.total);
    } catch (error) {
      setResults((current) => current ?? { total: 0, questions: [] });
      toast(errorText(error));
    }
  };

  useEffect(() => {
    void load(items.length);
  }, [form.id, revision]);

  const more = async () => {
    setBusy(true);
    try {
      const page = await api.get<{ total: number; items: ResponseItem[] }>(
        `/api/forms/${form.id}/responses?offset=${items.length}&limit=20`
      );
      setItems((current) => [...current, ...page.items.filter((entry) => !current.some((known) => known.id === entry.id))]);
      setTotal(page.total);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item: ResponseItem | null) => {
    const ok = await confirm(
      item
        ? { title: t('Diese Antwort löschen?'), text: t('Das lässt sich nicht rückgängig machen.'), confirm: t('Löschen'), danger: true }
        : {
            title: t('Alle Antworten löschen?'),
            text: tn(total, 'Die eine Antwort ist danach weg.', 'Alle {count} Antworten sind danach weg.'),
            confirm: t('Alle löschen'),
            danger: true,
          }
    );
    if (!ok) return;
    try {
      await api.delete(item ? `/api/forms/${form.id}/responses/${item.id}` : `/api/forms/${form.id}/responses`);
      toast(item ? t('Antwort gelöscht') : t('Alle Antworten gelöscht'));
      await load(item ? items.length : 0);
    } catch (error) {
      toast(errorText(error));
    }
  };

  if (!results) return <Skeleton variant="rounded" height={240} />;

  if (results.total === 0) {
    return (
      <EmptyState
        icon={<InsertChartOutlinedRounded />}
        title={t('Noch keine Antworten')}
        text={t('Teil den Link, dann erscheinen die Antworten hier, sobald sie ankommen.')}
        action={
          <Button variant="contained" startIcon={<LinkRounded />} onClick={() => void copyText(fullUrl(form), t('Link kopiert'))}>
            {t('Link kopieren')}
          </Button>
        }
      />
    );
  }

  const titleOf = (id: string) => form.questions.find((entry) => entry.id === id)?.title || t('Frage ohne Titel');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="h6" component="h2" sx={{ flex: '1 1 200px' }} data-total={results.total}>
          {tn(results.total, '{count} Antwort', '{count} Antworten')}
        </Typography>
        <Button component="a" href={`/api/forms/${form.id}/export`} download startIcon={<DownloadRounded />}>
          {t('Als CSV laden')}
        </Button>
        <Button color="error" startIcon={<DeleteOutlineRounded />} onClick={() => void remove(null)}>
          {t('Alle löschen')}
        </Button>
      </Box>
      {results.questions.map((summary) => (
        <SummaryCard key={summary.id} summary={summary} total={results.total} />
      ))}
      <Box sx={card}>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
          {t('Einzelne Antworten')}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((item) => (
            <Box key={item.id} data-response={item.id} sx={{ borderTop: `1px solid ${c.outlineVariant}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ButtonBase
                  onClick={() => setOpen((current) => (current === item.id ? null : item.id))}
                  aria-expanded={open === item.id}
                  sx={{ flex: 1, py: 1.25, px: 0.5, justifyContent: 'flex-start', textAlign: 'left', borderRadius: `${radius.sm}px` }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {item.person ? item.person.name : formatDateTime(item.createdAt)}
                  </Typography>
                  {item.person && (
                    <Typography variant="body2" sx={{ color: c.onSurfaceVariant, ml: 1 }}>
                      {formatDateTime(item.createdAt)}
                    </Typography>
                  )}
                </ButtonBase>
                <Tooltip title={t('Antwort löschen')}>
                  <IconButton aria-label={t('Antwort löschen')} onClick={() => void remove(item)}>
                    <DeleteOutlineRounded />
                  </IconButton>
                </Tooltip>
              </Box>
              {open === item.id && (
                <Box component="dl" sx={{ m: 0, pb: 1.5, px: 0.5, display: 'grid', gap: 1 }}>
                  {item.answers.map((answer) => (
                    <Box key={answer.question}>
                      <Typography component="dt" variant="caption" sx={{ color: c.onSurfaceVariant }}>
                        {titleOf(answer.question)}
                      </Typography>
                      <Typography component="dd" variant="body2" sx={{ m: 0, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                        {answer.text || '–'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          ))}
        </Box>
        {items.length < total && (
          <Button onClick={() => void more()} disabled={busy} sx={{ alignSelf: 'center' }}>
            {t('Weitere Antworten laden')}
          </Button>
        )}
      </Box>
    </Box>
  );
}

const localValue = (time: number | null) => {
  if (!time) return '';
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

type Flag = 'accepting' | 'once' | 'signedIn' | 'named' | 'notify';

function SettingsTab({
  form,
  onSave,
  onDeleted,
}: {
  form: Form;
  onSave: (patch: Partial<Form>) => Promise<boolean>;
  onDeleted: () => void;
}) {
  const [flags, setFlags] = useState<Record<Flag, boolean>>({
    accepting: form.accepting,
    once: form.once,
    signedIn: form.signedIn,
    named: form.named,
    notify: form.notify,
  });
  const [confirmation, setConfirmation] = useState(form.confirmation);
  const [limit, setLimit] = useState(form.maxResponses ? String(form.maxResponses) : '');
  const [closes, setCloses] = useState(localValue(form.closesAt));
  const [qr, setQr] = useState(false);

  const flip = async (key: Flag, checked: boolean) => {
    const patch: Partial<Record<Flag, boolean>> = key === 'signedIn' && !checked ? { signedIn: false, named: false } : { [key]: checked };
    const before = flags;
    setFlags({ ...flags, ...patch });
    if (!(await onSave(patch))) setFlags(before);
  };

  const toggle = (key: Flag, label: string, text: string, disabled = false) => (
    <FormControlLabel
      sx={{ m: 0, alignItems: 'flex-start', gap: 1.5 }}
      disabled={disabled}
      control={<Switch checked={flags[key]} onChange={(event) => void flip(key, event.target.checked)} />}
      label={
        <Box sx={{ pt: 0.75 }}>
          <Typography variant="body1">{label}</Typography>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {text}
          </Typography>
        </Box>
      }
    />
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Section sx={{ bgcolor: c.surfaceContainer }} title={t('Antworten')}>
        {toggle('accepting', t('Nimmt Antworten an'), t('Ausgeschaltet zeigt der Link nur noch, dass das Formular geschlossen ist.'))}
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            type="datetime-local"
            label={t('Schließt am')}
            value={closes}
            onChange={(event) => setCloses(event.target.value)}
            onBlur={() => {
              const time = closes ? new Date(closes).getTime() : null;
              if (time !== form.closesAt && (time === null || Number.isFinite(time))) void onSave({ closesAt: time });
            }}
            helperText={t('Freiwillig. Danach nimmt das Formular nichts mehr an.')}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ flex: '1 1 240px', maxWidth: 320 }}
          />
          <TextField
            type="number"
            label={t('Höchstens so viele Antworten')}
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            onBlur={() => {
              const value = limit.trim() ? Math.trunc(Number(limit)) : null;
              if (value !== null && (!Number.isFinite(value) || value < 1)) {
                setLimit(form.maxResponses ? String(form.maxResponses) : '');
                return;
              }
              if (value !== form.maxResponses) void onSave({ maxResponses: value });
            }}
            helperText={t('Freiwillig, etwa für begrenzte Plätze.')}
            slotProps={{ htmlInput: { min: 1, max: 50000 } }}
            sx={{ flex: '1 1 240px', maxWidth: 320 }}
          />
        </Box>
        {toggle(
          'once',
          t('Nur eine Antwort pro Person'),
          flags.signedIn ? t('Jedes Konto kann einmal antworten.') : t('Jeder Browser kann einmal antworten.')
        )}
        {toggle('signedIn', t('Nur für angemeldete Personen'), t('Wer kein Konto in dieser Cloud hat, kann nicht antworten.'))}
        {toggle(
          'named',
          t('Namen der Antwortenden speichern'),
          t('Sonst bleiben auch angemeldete Personen in den Antworten anonym.'),
          !flags.signedIn
        )}
        {toggle(
          'notify',
          t('Bei neuen Antworten benachrichtigen'),
          t('Mehrere Antworten kurz hintereinander kommen als eine Benachrichtigung.')
        )}
      </Section>
      <Section sx={{ bgcolor: c.surfaceContainer }} title={t('Nach dem Absenden')}>
        <TextField
          label={t('Text nach dem Absenden')}
          placeholder={t('Deine Antwort ist angekommen.')}
          value={confirmation}
          multiline
          minRows={2}
          onChange={(event) => setConfirmation(event.target.value.slice(0, 2000))}
          onBlur={() => {
            if (confirmation !== form.confirmation) void onSave({ confirmation });
          }}
        />
      </Section>
      <Section
        sx={{ bgcolor: c.surfaceContainer }}
        title={t('Link')}
        description={t('Wer den Link kennt, kann das Formular ausfüllen. Er verrät nichts über deine Dateien.')}
      >
        <CopyField value={fullUrl(form)} label={t('Link zum Formular')} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button startIcon={<QrCode2Rounded />} onClick={() => setQr((value) => !value)}>
            {qr ? t('QR-Code ausblenden') : t('QR-Code zeigen')}
          </Button>
          <Button
            startIcon={<AutorenewRounded />}
            onClick={async () => {
              const ok = await confirm({
                title: t('Neuen Link erzeugen?'),
                text: t('Der bisherige Link funktioniert danach nicht mehr. Die Antworten bleiben.'),
                confirm: t('Neuer Link'),
              });
              if (!ok) return;
              try {
                await api.post(`/api/forms/${form.id}/token`);
                toast(t('Neuer Link erzeugt'));
              } catch (error) {
                toast(errorText(error));
              }
            }}
          >
            {t('Neuen Link erzeugen')}
          </Button>
        </Box>
        {qr && (
          <Box sx={{ alignSelf: 'flex-start', p: 2, bgcolor: '#fff', borderRadius: `${radius.md}px` }}>
            <QrCode value={fullUrl(form)} size={192} label={t('QR-Code zum Formular')} />
          </Box>
        )}
      </Section>
      <Section
        sx={{ bgcolor: c.surfaceContainer }}
        title={t('Formular löschen')}
        description={t('Das Formular und alle Antworten verschwinden endgültig.')}
      >
        <Button
          color="error"
          variant="outlined"
          startIcon={<DeleteOutlineRounded />}
          sx={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            if (await removeForm(form)) onDeleted();
          }}
        >
          {t('Formular löschen')}
        </Button>
      </Section>
    </Box>
  );
}

const TABS = ['fragen', 'antworten', 'einstellungen'] as const;
type TabKey = (typeof TABS)[number];

const tabFromHash = (): TabKey => {
  const hash = location.hash.replace('#', '');
  return (TABS as readonly string[]).includes(hash) ? (hash as TabKey) : 'fragen';
};

function FormEditor({ id }: { id: string }) {
  const [form, setForm] = useState<Form | null>(null);
  const [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<TabKey>(tabFromHash);
  const [status, setStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [revision, setRevision] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Draft | null>(null);

  const refresh = async () => {
    try {
      const data = await api.get<{ form: Form }>(`/api/forms/${id}`);
      setForm(data.form);
      setDraft((current) => current ?? { title: data.form.title, description: data.form.description, questions: data.form.questions });
    } catch {
      setMissing(true);
    }
  };

  useEffect(() => {
    void refresh();
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [id]);

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    setStatus('saving');
    try {
      const data = await api.patch<{ form: Form }>(`/api/forms/${id}`, {
        ...(next.title.trim() ? { title: next.title.trim() } : {}),
        description: next.description,
        questions: next.questions,
      });
      setForm(data.form);
      setStatus(pending.current ? 'saving' : 'saved');
    } catch (error) {
      setStatus('error');
      toast(errorText(error));
    }
  };

  useEffect(
    () => () => {
      if (pending.current) void flush();
    },
    []
  );

  useLive((event) => {
    if (event === 'forms' || event === 'reconnect') {
      setRevision((value) => value + 1);
      void api
        .get<{ form: Form }>(`/api/forms/${id}`)
        .then((data) => setForm(data.form))
        .catch(() => {});
    }
  });

  const change = (next: Draft) => {
    setDraft(next);
    pending.current = next;
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  const save = async (patch: Partial<Form>) => {
    try {
      const data = await api.patch<{ form: Form }>(`/api/forms/${id}`, patch);
      setForm(data.form);
      toast(t('Gespeichert'));
      return true;
    } catch (error) {
      toast(errorText(error));
      return false;
    }
  };

  const select = (next: TabKey) => {
    if (pending.current) void flush();
    setTab(next);
    history.replaceState(history.state, '', next === 'fragen' ? location.pathname : `${location.pathname}#${next}`);
  };

  if (missing) {
    return (
      <EmptyState
        icon={<AssignmentRounded />}
        title={t('Das Formular gibt es nicht')}
        text={t('Vielleicht wurde es gelöscht.')}
        action={
          <Button variant="contained" onClick={() => navigate('/files/forms')}>
            {t('Zu den Formularen')}
          </Button>
        }
      />
    );
  }

  if (!form || !draft) return <Skeleton variant="rounded" height={320} sx={{ mx: { xs: 1.5, md: 2 } }} />;

  return (
    <Box sx={{ px: { xs: 1.5, md: 2 }, pb: 6, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 860, width: '100%', mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Tooltip title={t('Alle Formulare')}>
          <IconButton aria-label={t('Alle Formulare')} onClick={() => navigate('/files/forms')}>
            <ArrowBackRounded />
          </IconButton>
        </Tooltip>
        <Typography variant="h6" component="h2" sx={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>
          {draft.title.trim() || form.title}
        </Typography>
        <StateChip state={form.state} />
        <Typography variant="caption" sx={{ color: status === 'error' ? c.error : c.onSurfaceVariant, minWidth: 80 }} aria-live="polite">
          {status === 'saving' ? t('Speichert …') : status === 'error' ? t('Nicht gespeichert') : t('Gespeichert')}
        </Typography>
        <Button startIcon={<LinkRounded />} onClick={() => void copyText(fullUrl(form), t('Link kopiert'))}>
          {t('Link kopieren')}
        </Button>
        <Button
          component="a"
          href={form.url}
          target="_blank"
          rel="noopener"
          startIcon={<OpenInNewRounded />}
          onClick={() => {
            if (pending.current) void flush();
          }}
        >
          {t('Ansehen')}
        </Button>
      </Box>
      <Tabs value={tab} onChange={(_event, value: TabKey) => select(value)} variant="scrollable" allowScrollButtonsMobile>
        <Tab value="fragen" label={t('Fragen')} />
        <Tab value="antworten" label={tn(form.responses, '{count} Antwort', '{count} Antworten')} />
        <Tab value="einstellungen" label={t('Einstellungen')} />
      </Tabs>
      {tab === 'fragen' && <QuestionsTab draft={draft} onChange={change} />}
      {tab === 'antworten' && <AnswersTab form={form} revision={revision} />}
      {tab === 'einstellungen' && <SettingsTab key={form.id} form={form} onSave={save} onDeleted={() => navigate('/files/forms')} />}
    </Box>
  );
}

export function FormsView({ id }: { id: string | null }) {
  return id ? <FormEditor key={id} id={id} /> : <FormList />;
}
