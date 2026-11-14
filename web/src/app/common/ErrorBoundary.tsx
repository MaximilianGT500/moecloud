import { Component, type ErrorInfo, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { t } from '../../lib/i18n';
import { c } from '../../theme/tokens';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Box role="alert" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 3, textAlign: 'center' }}>
        <Box sx={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          <Typography variant="h5" component="h1">
            {t('Das hat nicht geklappt')}
          </Typography>
          <Typography variant="body2" sx={{ color: c.onSurfaceVariant }}>
            {t('Diese Seite ist auf einen Fehler gestoßen. Lad sie neu, deinen Dateien passiert dabei nichts.')}
          </Typography>
          <Button variant="contained" onClick={() => location.reload()}>
            {t('Neu laden')}
          </Button>
        </Box>
      </Box>
    );
  }
}
