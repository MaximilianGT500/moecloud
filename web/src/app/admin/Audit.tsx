import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import { api, errorText } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';
import { auditDetail, auditLabel, FAILED_ACTIONS, type AuditEntry } from '../common/audit';
import { Section } from '../common/bits';
import { toast } from '../common/toast';
import { Loading } from './shared';

const GROUPS: Record<string, string[]> = {
  security: [
    'login',
    'login_failed',
    'logout',
    'password_changed',
    'password_reset_requested',
    'password_reset',
    'totp_enabled',
    'totp_disabled',
    'recovery_codes',
    'passkey_added',
    'passkey_removed',
    'app_password_created',
    'app_password_removed',
    'sessions_revoked',
    'sso_unlinked',
    'account_exported',
  ],
  failed: ['login_failed'],
  people: [
    'registered',
    'user_created',
    'user_updated',
    'user_deleted',
    'user_disabled',
    'user_enabled',
    'role_changed',
    'admin_password_set',
    'admin_2fa_reset',
    'admin_logout',
    'files_transferred',
    'files_recovered',
    'invite_created',
    'invite_deleted',
    'group_created',
    'group_updated',
    'group_deleted',
    'users_imported',
  ],
  system: [
    'settings_changed',
    'mail_changed',
    'sso_changed',
    'scan_changed',
    'webhook_changed',
    'link_removed',
    'backup_created',
    'backup_deleted',
    'backup_failed',
    'maintenance',
  ],
  virus: ['virus_found', 'virus_released', 'virus_deleted'],
};

function groupLabel(group: string) {
  switch (group) {
    case 'security':
      return t('Anmeldung und Sicherheit');
    case 'failed':
      return t('Fehlgeschlagene Anmeldungen');
    case 'people':
      return t('Personen und Einladungen');
    case 'system':
      return t('Einstellungen und System');
    case 'virus':
      return t('Virenscan');
    default:
      return t('Alles');
  }
}

export function AuditSection() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [group, setGroup] = useState('');
  const [people, setPeople] = useState<{ id: number; name: string; username: string }[]>([]);
  const [person, setPerson] = useState<number | ''>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get<{ items: { id: number; name: string; username: string }[] }>('/api/admin/people')
      .then((result) => setPeople(result.items))
      .catch(() => {});
  }, []);

  const query = (before?: number) => {
    const params = new URLSearchParams();
    if (before) params.set('before', String(before));
    if (group) params.set('action', GROUPS[group].join(','));
    if (person) params.set('user', String(person));
    return `/api/admin/audit?${params}`;
  };

  useEffect(() => {
    const abort = new AbortController();
    api
      .get<{ items: AuditEntry[]; more: boolean }>(query(), abort.signal)
      .then((page) => {
        setEntries(page.items);
        setMore(page.more);
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') toast(errorText(error));
      });
    return () => abort.abort();
  }, [group, person]);

  const loadMore = async () => {
    if (!entries?.length) return;
    setLoading(true);
    try {
      const page = await api.get<{ items: AuditEntry[]; more: boolean }>(query(entries[entries.length - 1].id));
      setEntries([...entries, ...page.items]);
      setMore(page.more);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section
      title={t('Ereignisse')}
      description={t('Wer sich wann angemeldet hat, was die Verwaltung geändert hat und was der Virenscan gefunden hat.')}
    >
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('Bereich')}
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          sx={{ minWidth: 240 }}
        >
          <MenuItem value="">{t('Alles')}</MenuItem>
          {Object.keys(GROUPS).map((key) => (
            <MenuItem key={key} value={key}>
              {groupLabel(key)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t('Person')}
          value={person}
          onChange={(event) => setPerson(event.target.value === '' ? '' : Number(event.target.value))}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">{t('Alle')}</MenuItem>
          {people.map((entry) => (
            <MenuItem key={entry.id} value={entry.id}>
              {entry.name} (@{entry.username})
            </MenuItem>
          ))}
        </TextField>
      </Box>
      {!entries ? (
        <Loading />
      ) : entries.length === 0 ? (
        <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
          {t('Keine Einträge.')}
        </Typography>
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {entries.map((entry) => {
            const failed = FAILED_ACTIONS.has(entry.action);
            const who = entry.actor
              ? `${entry.actor.name || '?'}${entry.actor.username ? ` (@${entry.actor.username})` : ''}`
              : t('System');
            const detail = auditDetail(entry);
            return (
              <Box
                component="li"
                key={entry.id}
                sx={{
                  display: 'flex',
                  gap: 1.5,
                  py: 1,
                  borderBottom: `1px solid ${c.outlineVariant}`,
                  '&:last-of-type': { borderBottom: 0 },
                }}
              >
                {failed ? (
                  <ErrorOutlineRounded sx={{ color: c.error, mt: 0.25 }} />
                ) : (
                  <ShieldRounded sx={{ color: c.onSurfaceVariant, mt: 0.25 }} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {auditLabel(entry.action)}
                    {entry.subject ? (
                      <Box component="span" sx={{ fontWeight: 400, color: c.onSurfaceVariant }}>
                        {' '}
                        · {entry.subject.name || entry.subject.username}
                      </Box>
                    ) : null}
                  </Typography>
                  <Typography variant="caption" component="p" sx={{ color: c.onSurfaceVariant, overflowWrap: 'anywhere' }}>
                    {[who, detail, entry.ip].filter(Boolean).join(' · ')}
                  </Typography>
                </Box>
                <Typography variant="caption" component="time" sx={{ color: c.onSurfaceVariant, flex: 'none', textAlign: 'right' }}>
                  {formatDateTime(entry.createdAt)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
      {more && (
        <Button sx={{ alignSelf: 'flex-start' }} disabled={loading} onClick={() => void loadMore()}>
          {t('Ältere anzeigen')}
        </Button>
      )}
    </Section>
  );
}
