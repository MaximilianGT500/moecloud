import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Typography from '@mui/material/Typography';
import { t } from '../../lib/i18n';
import { c, radius } from '../../theme/tokens';

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Key({ children }: { children: string }) {
  return (
    <Box
      component="kbd"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 28,
        height: 28,
        px: 1,
        borderRadius: `${radius.xs}px`,
        bgcolor: c.surfaceContainerHighest,
        color: c.onSurface,
        border: `1px solid ${c.outlineVariant}`,
        fontFamily: 'inherit',
        fontSize: '0.8125rem',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

function groups(): { title: string; rows: [string[], string][] }[] {
  const ctrl = mac ? '⌘' : t('Strg');
  return [
    {
      title: t('Überall'),
      rows: [
        [['/'], t('Suchen')],
        [['?'], t('Diese Übersicht')],
      ],
    },
    {
      title: t('In der Liste'),
      rows: [
        [['↑', '↓'], t('Zwischen den Elementen wechseln')],
        [[t('Pos1'), t('Ende')], t('Zum ersten oder letzten Element')],
        [['Enter'], t('Öffnen')],
        [[t('Leertaste')], t('Auswählen')],
        [[ctrl, 'A'], t('Alles auswählen')],
        [[t('Entf')], t('In den Papierkorb')],
        [['F2'], t('Umbenennen')],
        [['Esc'], t('Auswahl aufheben')],
        [[t('Umschalt'), 'F10'], t('Menü des Elements')],
      ],
    },
    {
      title: t('In der Vorschau'),
      rows: [
        [['←', '→'], t('Vorherige oder nächste Datei')],
        [['I'], t('Informationen ein- oder ausblenden')],
        [[ctrl, 'S'], t('Text speichern')],
        [['Esc'], t('Schließen')],
      ],
    },
  ];
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('Tastenkürzel')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {groups().map((group) => (
          <Box key={group.title} component="section">
            <Typography variant="overline" component="h3" sx={{ color: c.onSurfaceVariant, display: 'block', mb: 1 }}>
              {group.title}
            </Typography>
            <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', rowGap: 1.25, columnGap: 2 }}>
              {group.rows.map(([keys, label]) => (
                <Box key={label} sx={{ display: 'contents' }}>
                  <Box component="dt" sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                    {keys.map((key) => (
                      <Key key={key}>{key}</Key>
                    ))}
                  </Box>
                  <Typography component="dd" variant="body2" sx={{ m: 0, alignSelf: 'center' }}>
                    {label}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          {t('Fertig')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
