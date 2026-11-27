import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { c, fonts, radius } from '../../theme/tokens';
import { highlightAs } from '../files/preview/highlight';
import { codeTokens } from '../files/preview/styles';

export function CodeView({
  code,
  language,
  wrap = false,
  maxHeight,
}: {
  code: string;
  language: string;
  wrap?: boolean;
  maxHeight?: number | string;
}) {
  const highlighted = useMemo(() => highlightAs(code, language), [code, language]);
  const lines = useMemo(() => Math.max(1, code.replace(/\n$/, '').split('\n').length), [code]);
  return (
    <Box
      data-code-view
      sx={{
        display: 'flex',
        borderRadius: `${radius.md}px`,
        bgcolor: c.surfaceContainerLow,
        border: `1px solid ${c.outlineVariant}`,
        overflow: 'auto',
        maxHeight,
        fontFamily: fonts.mono,
        fontSize: '0.8125rem',
        lineHeight: 1.7,
      }}
    >
      {!wrap && (
        <Box
          aria-hidden
          sx={{
            flex: 'none',
            py: 1.5,
            px: 1.25,
            textAlign: 'right',
            color: c.onSurfaceVariant,
            opacity: 0.6,
            userSelect: 'none',
            borderRight: `1px solid ${c.outlineVariant}`,
            whiteSpace: 'pre',
            position: 'sticky',
            left: 0,
            bgcolor: c.surfaceContainerLow,
          }}
        >
          {Array.from({ length: lines }, (_entry, index) => index + 1).join('\n')}
        </Box>
      )}
      <Box
        component="pre"
        sx={{
          m: 0,
          py: 1.5,
          px: 2,
          flex: 1,
          minWidth: 0,
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          overflowWrap: wrap ? 'anywhere' : 'normal',
          tabSize: 2,
          color: c.onSurface,
          ...codeTokens,
        }}
      >
        {highlighted ? <code dangerouslySetInnerHTML={{ __html: highlighted.html }} /> : <code>{code}</code>}
      </Box>
    </Box>
  );
}
