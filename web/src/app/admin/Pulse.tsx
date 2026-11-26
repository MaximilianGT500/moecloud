import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { api, errorText } from '../../lib/api';
import { boot } from '../../lib/boot';
import { language, t } from '../../lib/i18n';
import { navigate } from '../../lib/router';
import { PulseConsent, PulseSupport, PulseUpdate } from '../../moepulse';
import { c, radius } from '../../theme/tokens';
import { Section } from '../common/bits';
import { toast } from '../common/toast';
import { NoticesBanner, updateCommand } from './Overview';
import { announceUnread, loadPulse, supportClient, type PulseInfo } from './pulseClient';
import { Loading } from './shared';

function Locked() {
  return (
    <Alert severity="info">
      {t('Mit MOEPULSE_DISABLED=1 oder MOEPULSE_ENDPOINT=off ist der Kontakt zu MoeStudio auf diesem Server fest abgeschaltet.')}
    </Alert>
  );
}

export function PulseConsentSection() {
  const [info, setInfo] = useState<PulseInfo | null>(null);

  useEffect(() => {
    loadPulse()
      .then(setInfo)
      .catch((error) => toast(errorText(error)));
  }, []);

  return (
    <Section
      id="nutzungsstatistik"
      title={t('Daten an MoeStudio')}
      description={t('Beides ist aus, bis du es einschaltest. Die Vorschau zeigt genau, was gesendet würde.')}
    >
      {!info ? (
        <Loading />
      ) : (
        <Box data-pulse-consent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {info.locked && <Locked />}
          <PulseConsent
            texts={info.texts}
            value={info.value}
            status={info.status}
            disabled={info.locked}
            language={language}
            onChange={async (value) => {
              try {
                setInfo(await api.put<PulseInfo>('/api/admin/pulse', value));
                toast(t('Gespeichert'));
              } catch (error) {
                toast(errorText(error));
              }
            }}
            preview={() => api.get('/api/admin/pulse/preview').catch((error) => ({ error: errorText(error) }))}
            onForget={async () => {
              try {
                const result = await api.post<{ ok: boolean }>('/api/admin/pulse/forget');
                setInfo(await loadPulse());
                return result.ok;
              } catch {
                return false;
              }
            }}
          />
        </Box>
      )}
    </Section>
  );
}

export function HelpSection() {
  const [info, setInfo] = useState<PulseInfo | null>(null);
  const user = boot().user;

  useEffect(() => {
    loadPulse()
      .then(setInfo)
      .catch((error) => toast(errorText(error)));
  }, []);

  if (!info) return <Loading />;

  return (
    <Box data-help sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {!info.locked && <NoticesBanner />}
      <Box
        component="section"
        aria-label={t('Support')}
        sx={{ bgcolor: c.surfaceContainerLow, borderRadius: `${radius.lg}px`, p: { xs: 2, sm: 3 } }}
      >
        {info.locked ? (
          <Locked />
        ) : (
          <PulseSupport
            support={supportClient}
            language={language}
            developer={t('Max von MoeStudio')}
            defaults={{ name: user?.name ?? undefined, email: user?.email ?? undefined }}
            diagnostics={info.value.stats}
            privacy={t(
              'Deine Nachricht geht mit der MoeCloud-Version an MoeStudio und wird nur für diese Anfrage verwendet. Löschst du unter System die gesendeten Daten, verschwinden auch deine Nachrichten.'
            )}
            onUnread={announceUnread}
          />
        )}
      </Box>
      <Section title={t('Updates')}>
        {info.locked || !info.updates ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('Deine Version und verfügbare Updates siehst du unter')}{' '}
            <Link
              href="/admin/system"
              onClick={(event) => {
                event.preventDefault();
                navigate('/admin/system');
              }}
            >
              {t('System')}
            </Link>
            .
          </Typography>
        ) : (
          <PulseUpdate
            load={supportClient.update}
            app="MoeCloud"
            language={language}
            instructions={
              <Box component="code" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {updateCommand(info.install)}
              </Box>
            }
          />
        )}
      </Section>
    </Box>
  );
}
