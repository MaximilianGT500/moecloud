import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import MailRounded from '@mui/icons-material/MailRounded';
import { api, errorText } from '../../lib/api';
import { formatBytes, formatDay } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { CopyField, Section } from '../common/bits';
import { QuotaField } from '../common/QuotaField';
import { toast } from '../common/toast';
import { Loading } from './shared';

interface Invite {
  id: string;
  note: string | null;
  email: string | null;
  quota: number | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  expired: boolean;
}

const EMPTY = { open: false, note: '', email: '', days: 7, quota: null as number | null };

export function InvitesSection({ registration }: { registration: string }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [mail, setMail] = useState(false);
  const [created, setCreated] = useState<{ url: string; sent: boolean } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .get<{ items: Invite[]; mail: boolean }>('/api/admin/invites')
      .then((result) => {
        setInvites(result.items);
        setMail(result.mail);
      })
      .catch((error) => toast(errorText(error)));

  useEffect(() => {
    void load();
  }, []);

  const close = () => {
    setForm(EMPTY);
    setCreated(null);
  };

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ url: string; sent: boolean }>('/api/admin/invites', {
        note: form.note || null,
        days: form.days,
        quota: form.quota,
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
      });
      setCreated(result);
      void load();
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title={t('Einladungslinks')}
      description={t('Mit einem Einladungslink legt sich eine Person selbst ein Konto an. Jeder Link funktioniert einmal.')}
      action={
        <Button variant="contained" startIcon={<AddRounded />} onClick={() => setForm({ ...EMPTY, open: true })}>
          {t('Einladung erstellen')}
        </Button>
      }
    >
      {registration === 'closed' && (
        <Alert severity="info">{t('Einladungen funktionieren auch, wenn die Registrierung geschlossen ist.')}</Alert>
      )}
      {!invites ? (
        <Loading />
      ) : invites.length === 0 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Noch keine Einladungen.')}
        </Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {invites.map((invite) => (
            <Box component="li" key={invite.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 0.75 }}>
              {invite.usedAt ? (
                <CheckCircleRounded sx={{ color: c.success }} />
              ) : (
                <MailRounded sx={{ color: invite.expired ? c.outline : c.onSurfaceVariant }} />
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
                  {invite.note || invite.email || t('Einladung')}
                </Typography>
                <Typography variant="caption" sx={{ color: c.onSurfaceVariant }}>
                  {[
                    invite.usedAt
                      ? t('Genutzt von {name}', { name: invite.usedBy ?? '?' })
                      : invite.expired
                        ? t('Abgelaufen')
                        : t('Gültig bis {date}', { date: formatDay(invite.expiresAt) }),
                    invite.email && invite.note ? invite.email : null,
                    invite.quota ? formatBytes(invite.quota) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Box>
              <Tooltip title={t('Löschen')}>
                <IconButton
                  aria-label={t('Einladung löschen')}
                  onClick={async () => {
                    await api.delete(`/api/admin/invites/${invite.id}`).catch((error) => toast(errorText(error)));
                    void load();
                  }}
                >
                  <DeleteOutlineRounded />
                </IconButton>
              </Tooltip>
            </Box>
          ))}
        </Box>
      )}
      <Dialog open={form.open} onClose={close} fullWidth maxWidth="sm">
        <DialogTitle>{created ? t('Einladungslink') : t('Einladung erstellen')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          {created ? (
            <>
              <Typography variant="body2">
                {created.sent
                  ? t('Die Einladung ist per E-Mail unterwegs. Den Link kannst du zusätzlich selbst weitergeben.')
                  : t('Schick diesen Link an die Person. Er funktioniert einmal.')}
              </Typography>
              <CopyField value={created.url} label={t('Link')} />
            </>
          ) : (
            <>
              <TextField
                label={t('Notiz (freiwillig)')}
                placeholder={t('zum Beispiel Für Lea')}
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
              <TextField
                label={t('Per E-Mail verschicken an (freiwillig)')}
                type="email"
                placeholder="lea@example.com"
                value={form.email}
                disabled={!mail}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                helperText={
                  mail ? t('Leer lassen, wenn du den Link selbst weitergibst.') : t('Dafür muss der E-Mail-Versand eingerichtet sein.')
                }
              />
              <TextField
                select
                label={t('Gültig für')}
                value={form.days}
                onChange={(event) => setForm({ ...form, days: Number(event.target.value) })}
              >
                {[1, 3, 7, 14, 30, 90].map((days) => (
                  <MenuItem key={days} value={days}>
                    {tn(days, '{count} Tag', '{count} Tage')}
                  </MenuItem>
                ))}
              </TextField>
              <QuotaField label={t('Speicher')} value={form.quota} allowDefault onChange={(quota) => setForm({ ...form, quota })} />
            </>
          )}
        </DialogContent>
        <DialogActions>
          {created ? (
            <Button variant="contained" onClick={close}>
              {t('Fertig')}
            </Button>
          ) : (
            <>
              <Button onClick={close}>{t('Abbrechen')}</Button>
              <Button variant="contained" disabled={busy} onClick={() => void create()}>
                {form.email.trim() ? t('Erstellen und senden') : t('Erstellen')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Section>
  );
}
