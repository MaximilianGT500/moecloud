import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import type { Feature } from '../../../../shared/features';
import { t } from '../../lib/i18n';
import { c, curve, radius } from '../../theme/tokens';
import { APP_GROUPS, appCatalog, groupLabel, type AppInfo } from './apps';

export function AppPicker({
  selected,
  onChange,
  available = () => true,
  compact = false,
}: {
  selected: ReadonlySet<Feature>;
  onChange: (next: Set<Feature>) => void;
  available?: (key: Feature) => boolean;
  compact?: boolean;
}) {
  const catalog = appCatalog().filter((app) => available(app.key));
  const blocked = (app: AppInfo) => Boolean(app.parent && !selected.has(app.parent));
  const toggle = (app: AppInfo) => {
    const next = new Set(selected);
    if (next.has(app.key)) {
      next.delete(app.key);
      for (const child of catalog) if (child.parent === app.key) next.delete(child.key);
    } else next.add(app.key);
    onChange(next);
  };
  return (
    <Box data-app-picker sx={{ display: 'flex', flexDirection: 'column', gap: compact ? 1.5 : 2 }}>
      {APP_GROUPS.map((group) => {
        const apps = catalog.filter((app) => app.group === group);
        if (!apps.length) return null;
        return (
          <Box key={group} role="group" aria-label={groupLabel(group)} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="overline" sx={{ color: c.onSurfaceVariant, lineHeight: 1.6 }}>
              {groupLabel(group)}
            </Typography>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: compact ? '1fr 1fr' : '1fr 1fr 1fr' }, gap: 1 }}
            >
              {apps.map((app) => {
                const on = selected.has(app.key) && !blocked(app);
                const off = blocked(app);
                return (
                  <ButtonBase
                    key={app.key}
                    role="checkbox"
                    aria-checked={on}
                    aria-disabled={off || undefined}
                    data-app={app.key}
                    disabled={off}
                    onClick={() => toggle(app)}
                    sx={{
                      justifyContent: 'flex-start',
                      alignItems: 'flex-start',
                      textAlign: 'left',
                      gap: 1.5,
                      p: 1.5,
                      borderRadius: `${radius.md}px`,
                      bgcolor: on ? c.secondaryContainer : c.surfaceContainer,
                      color: on ? c.onSecondaryContainer : c.onSurface,
                      boxShadow: on ? `inset 0 0 0 2px ${c.primary}` : 'none',
                      opacity: off ? 0.5 : 1,
                      transition: `background-color 160ms ${curve.standard}, box-shadow 160ms ${curve.standard}`,
                      '&.Mui-focusVisible': { outline: `2px solid ${c.primary}`, outlineOffset: 2 },
                    }}
                  >
                    <Box
                      sx={{
                        width: 36,
                        height: 36,
                        flex: 'none',
                        borderRadius: `${radius.sm}px`,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: on ? c.primary : c.surfaceContainerHighest,
                        color: on ? c.onPrimary : c.onSurfaceVariant,
                        '& svg': { fontSize: 20 },
                      }}
                    >
                      {app.icon}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {app.label}
                      </Typography>
                      {!compact && (
                        <Typography
                          variant="caption"
                          component="p"
                          sx={{ color: on ? c.onSecondaryContainer : c.onSurfaceVariant, opacity: 0.9 }}
                        >
                          {off ? t('Geht nur zusammen mit dem Kalender') : app.text}
                        </Typography>
                      )}
                    </Box>
                    <Box sx={{ color: on ? c.primary : c.outline, display: 'grid', '& svg': { fontSize: 20 } }}>
                      {on ? <CheckCircleRounded /> : <RadioButtonUncheckedRounded />}
                    </Box>
                  </ButtonBase>
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
