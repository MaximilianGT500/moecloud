import { useEffect, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import BackupRounded from '@mui/icons-material/BackupRounded';
import DashboardRounded from '@mui/icons-material/DashboardRounded';
import DnsRounded from '@mui/icons-material/DnsRounded';
import GppGoodRounded from '@mui/icons-material/GppGoodRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MailRounded from '@mui/icons-material/MailRounded';
import MarkEmailUnreadRounded from '@mui/icons-material/MarkEmailUnreadRounded';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import WebhookRounded from '@mui/icons-material/WebhookRounded';
import { boot } from '../../lib/boot';
import { t } from '../../lib/i18n';
import { navigate, useLocation } from '../../lib/router';
import { c, curve, mix, radius } from '../../theme/tokens';
import { AppShell } from '../shell/AppShell';
import { AuditSection } from './Audit';
import { BackupsSection } from './Backups';
import { InvitesSection } from './Invites';
import { LinksSection } from './Links';
import { MailSection } from './Mail';
import { OverviewSection } from './Overview';
import { PeopleSection } from './People';
import { ScanSection } from './Scan';
import { SettingsSection } from './Settings';
import { loadSettings } from './shared';
import { SystemSection } from './System';
import { WebhooksSection } from './Webhooks';

type SectionKey = 'overview' | 'people' | 'invites' | 'links' | 'audit' | 'scan' | 'mail' | 'webhooks' | 'backups' | 'settings' | 'system';

const LEGACY: Record<string, SectionKey> = { users: 'people', invites: 'invites', settings: 'settings', overview: 'overview' };

function sections(): { key: SectionKey; label: string; icon: ReactNode; group: number }[] {
  return [
    { key: 'overview', label: t('Übersicht'), icon: <DashboardRounded />, group: 0 },
    { key: 'people', label: t('Personen'), icon: <PeopleRounded />, group: 1 },
    { key: 'invites', label: t('Einladungen'), icon: <MarkEmailUnreadRounded />, group: 1 },
    { key: 'links', label: t('Links'), icon: <LinkRounded />, group: 1 },
    { key: 'audit', label: t('Protokoll'), icon: <ReceiptLongRounded />, group: 1 },
    { key: 'scan', label: t('Virenscan'), icon: <GppGoodRounded />, group: 2 },
    { key: 'mail', label: t('E-Mail'), icon: <MailRounded />, group: 2 },
    { key: 'webhooks', label: t('Webhooks'), icon: <WebhookRounded />, group: 2 },
    { key: 'backups', label: t('Sicherungen'), icon: <BackupRounded />, group: 2 },
    { key: 'settings', label: t('Einstellungen'), icon: <SettingsRounded />, group: 3 },
    { key: 'system', label: t('System'), icon: <DnsRounded />, group: 3 },
  ];
}

const hrefOf = (key: SectionKey) => (key === 'overview' ? '/admin' : `/admin/${key}`);

function NavLink({ item, active }: { item: ReturnType<typeof sections>[number]; active: boolean }) {
  return (
    <ButtonBase
      component="a"
      href={hrefOf(item.key)}
      nativeButton={false}
      aria-current={active ? 'page' : undefined}
      onClick={(event: MouseEvent) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(hrefOf(item.key));
        document.getElementById('inhalt')?.scrollTo({ top: 0 });
        window.scrollTo({ top: 0 });
      }}
      sx={{
        justifyContent: 'flex-start',
        gap: 1.5,
        width: '100%',
        height: 48,
        px: 2,
        borderRadius: `${radius.full}px`,
        fontWeight: active ? 700 : 500,
        fontSize: '0.9375rem',
        color: active ? c.onSecondaryContainer : c.onSurfaceVariant,
        bgcolor: active ? c.secondaryContainer : 'transparent',
        transition: `background-color 160ms ${curve.standard}`,
        '&:hover': { bgcolor: active ? c.secondaryContainer : mix(c.onSurface, 8) },
        '& svg': { fontSize: 22 },
        '&.Mui-focusVisible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
      }}
    >
      {item.icon}
      {item.label}
    </ButtonBase>
  );
}

export function AdminPage() {
  const { path, query } = useLocation();
  const list = sections();
  const slug = path.replace(/^\/admin\/?/, '').split('/')[0];
  const section: SectionKey = list.some((item) => item.key === slug) ? (slug as SectionKey) : 'overview';
  const [registration, setRegistration] = useState('closed');

  useEffect(() => {
    const legacy = query.get('tab');
    if (legacy && LEGACY[legacy]) navigate(hrefOf(LEGACY[legacy]), { replace: true });
  }, [query]);

  useEffect(() => {
    loadSettings()
      .then((settings) => setRegistration(String(settings['auth.registration'] ?? 'closed')))
      .catch(() => {});
  }, []);

  const current = list.find((item) => item.key === section)!;

  useEffect(() => {
    document.title = `${current.label} » ${t('Verwaltung')} » ${boot().site.name}`;
  }, [current.label]);

  return (
    <AppShell
      active="admin"
      framed={false}
      storage={boot().storage}
      topBar={
        <Typography variant="h5" component="p" sx={{ pl: 1, flex: 1 }}>
          {t('Verwaltung')}
        </Typography>
      }
    >
      <Box sx={{ display: 'flex', gap: 3, maxWidth: 1320, mx: 'auto', px: { xs: 1.5, sm: 2, md: 3 }, pb: 6 }}>
        <Box
          component="nav"
          aria-label={t('Bereiche der Verwaltung')}
          sx={{
            display: { xs: 'none', lg: 'flex' },
            flexDirection: 'column',
            gap: 0.5,
            width: 240,
            flex: 'none',
            position: 'sticky',
            top: 0,
            alignSelf: 'flex-start',
            pt: 0.5,
          }}
        >
          {list.map((item, index) => (
            <Box key={item.key}>
              {index > 0 && list[index - 1].group !== item.group && <Box sx={{ height: '1px', bgcolor: c.outlineVariant, my: 1, mx: 2 }} />}
              <NavLink item={item} active={item.key === section} />
            </Box>
          ))}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            component="nav"
            aria-label={t('Bereiche der Verwaltung')}
            sx={{
              display: { xs: 'flex', lg: 'none' },
              gap: 1,
              overflowX: 'auto',
              pb: 1.5,
              mb: 1,
              scrollbarWidth: 'none',
              mx: { xs: -1.5, sm: 0 },
              px: { xs: 1.5, sm: 0 },
            }}
          >
            {list.map((item) => (
              <Chip
                key={item.key}
                icon={item.icon as ReactElement}
                label={item.label}
                component="a"
                href={hrefOf(item.key)}
                clickable
                onClick={(event: MouseEvent) => {
                  event.preventDefault();
                  navigate(hrefOf(item.key));
                }}
                aria-current={item.key === section ? 'page' : undefined}
                variant={item.key === section ? 'filled' : 'outlined'}
                sx={{ flex: 'none', ...(item.key === section ? { bgcolor: c.secondaryContainer, color: c.onSecondaryContainer } : {}) }}
              />
            ))}
          </Box>
          <Typography variant="h4" component="h1" sx={{ mb: 2, px: { md: 0.5 } }}>
            {current.label}
          </Typography>
          {section === 'overview' && <OverviewSection />}
          {section === 'people' && <PeopleSection />}
          {section === 'invites' && <InvitesSection registration={registration} />}
          {section === 'links' && <LinksSection />}
          {section === 'audit' && <AuditSection />}
          {section === 'scan' && <ScanSection />}
          {section === 'mail' && <MailSection />}
          {section === 'webhooks' && <WebhooksSection />}
          {section === 'backups' && <BackupsSection />}
          {section === 'settings' && <SettingsSection onChanged={(settings) => setRegistration(String(settings['auth.registration']))} />}
          {section === 'system' && <SystemSection />}
        </Box>
      </Box>
    </AppShell>
  );
}
