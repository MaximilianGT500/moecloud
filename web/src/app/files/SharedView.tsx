import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import LinkRounded from '@mui/icons-material/LinkRounded';
import LockRounded from '@mui/icons-material/LockRounded';
import PeopleRounded from '@mui/icons-material/PeopleRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import { formatNumber } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';
import { EmptyState } from '../common/bits';
import { FileIcon, type Item } from './kinds';
import type { SharedGrant, SharedLink } from './model';

interface Group {
  node: Item;
  links: SharedLink[];
  grants: SharedGrant[];
}

export function SharedByMe({
  links,
  grants,
  onManage,
  onOpen,
}: {
  links: SharedLink[];
  grants: SharedGrant[];
  onManage: (item: Item) => void;
  onOpen: (item: Item) => void;
}) {
  const groups = new Map<string, Group>();
  for (const link of links) {
    if (!link.node) continue;
    const group = groups.get(link.node.id) ?? { node: link.node, links: [], grants: [] };
    group.links.push(link);
    groups.set(link.node.id, group);
  }
  for (const grant of grants) {
    if (!grant.node) continue;
    const group = groups.get(grant.node.id) ?? { node: grant.node, links: [], grants: [] };
    group.grants.push(grant);
    groups.set(grant.node.id, group);
  }
  if (groups.size === 0) {
    return (
      <EmptyState
        compact
        icon={<LinkRounded />}
        title={t('Du teilst noch nichts')}
        text={t('Öffne bei einer Datei oder einem Ordner „Teilen“, um einen Link zu erstellen oder Personen einzuladen.')}
      />
    );
  }
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {[...groups.values()].map((group) => {
        const views = group.links.reduce((sum, link) => sum + link.views, 0);
        return (
          <Box
            component="li"
            key={group.node.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              p: 1.5,
              pl: 2,
              borderRadius: `${radius.md}px`,
              bgcolor: c.surfaceContainer,
              flexWrap: { xs: 'wrap', sm: 'nowrap' },
            }}
          >
            <FileIcon item={group.node} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="body2"
                noWrap
                component="button"
                onClick={() => onOpen(group.node)}
                sx={{
                  fontWeight: 600,
                  border: 0,
                  p: 0,
                  bgcolor: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  font: 'inherit',
                  textAlign: 'left',
                  maxWidth: '100%',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {group.node.name}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.75 }}>
                {group.links.length > 0 && (
                  <Chip
                    size="small"
                    icon={group.links.some((link) => link.hasPassword) ? <LockRounded /> : <LinkRounded />}
                    label={`${tn(group.links.length, '{count} Link', '{count} Links')} · ${tn(views, '{count} Aufruf', '{count} Aufrufe', { count: formatNumber(views) })}`}
                  />
                )}
                {group.grants.length > 0 && (
                  <Chip
                    size="small"
                    icon={<PeopleRounded />}
                    label={group.grants.map((grant) => grant.user?.name ?? grant.group?.name ?? '?').join(', ')}
                  />
                )}
              </Box>
            </Box>
            <Button variant="tonal" size="small" startIcon={<TuneRounded />} onClick={() => onManage(group.node)}>
              {t('Verwalten')}
            </Button>
          </Box>
        );
      })}
    </Box>
  );
}
