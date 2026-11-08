import { c, fonts, mix, radius } from '../../../theme/tokens';

export const surfaceBox = {
  borderRadius: `${radius.md}px`,
  bgcolor: c.surfaceContainerLow,
  color: c.onSurface,
} as const;

export const codeTokens = {
  '& .hljs-comment, & .hljs-quote': { color: c.onSurfaceVariant, fontStyle: 'italic' },
  '& .hljs-keyword, & .hljs-selector-tag, & .hljs-built_in, & .hljs-type, & .hljs-doctag': { color: c.primary },
  '& .hljs-string, & .hljs-regexp, & .hljs-addition, & .hljs-template-tag, & .hljs-template-variable': { color: c.tertiary },
  '& .hljs-number, & .hljs-literal, & .hljs-symbol, & .hljs-bullet': { color: c.warning },
  '& .hljs-title, & .hljs-section, & .hljs-title.function_, & .hljs-name': { color: c.success, fontWeight: 600 },
  '& .hljs-attr, & .hljs-attribute, & .hljs-variable, & .hljs-property, & .hljs-params': { color: c.secondary },
  '& .hljs-meta, & .hljs-selector-id, & .hljs-selector-class, & .hljs-tag': { color: c.onSurfaceVariant },
  '& .hljs-deletion': { color: c.error },
  '& .hljs-emphasis': { fontStyle: 'italic' },
  '& .hljs-strong': { fontWeight: 700 },
} as const;

export const codeBlock = {
  m: 0,
  p: 2.5,
  overflow: 'auto',
  fontFamily: fonts.mono,
  fontSize: '0.875rem',
  lineHeight: 1.7,
  tabSize: 2,
  ...codeTokens,
} as const;

export const markdownBody = {
  px: { xs: 2.5, sm: 5 },
  py: { xs: 2, sm: 4 },
  overflow: 'auto',
  lineHeight: 1.7,
  fontSize: '1rem',
  overflowWrap: 'anywhere',
  '& > :first-of-type': { mt: 0 },
  '& h1, & h2, & h3, & h4, & h5, & h6': { lineHeight: 1.3, mt: 3, mb: 1.5, fontWeight: 800 },
  '& h1': { fontSize: '1.875rem' },
  '& h2': { fontSize: '1.5rem', pb: 0.75, borderBottom: `1px solid ${c.outlineVariant}` },
  '& h3': { fontSize: '1.25rem' },
  '& p, & ul, & ol, & blockquote, & table, & pre': { my: 1.5 },
  '& ul, & ol': { pl: 3 },
  '& li + li': { mt: 0.5 },
  '& li.task': { listStyle: 'none', ml: -2.5 },
  '& li.task > input': { m: 0, mr: 1, verticalAlign: 'middle', accentColor: c.primary, width: 16, height: 16 },
  '& a': { color: c.primary, textUnderlineOffset: '0.18em' },
  '& blockquote': { m: 0, my: 1.5, pl: 2, py: 0.5, borderLeft: `4px solid ${c.outlineVariant}`, color: c.onSurfaceVariant },
  '& code': {
    fontFamily: fonts.mono,
    fontSize: '0.875em',
    px: 0.75,
    py: 0.25,
    borderRadius: `${radius.xs}px`,
    bgcolor: c.surfaceContainerHigh,
  },
  '& pre': { p: 2, borderRadius: `${radius.tile}px`, bgcolor: c.surfaceContainer, overflow: 'auto', ...codeTokens },
  '& pre code': { p: 0, bgcolor: 'transparent', fontSize: '0.8125rem', lineHeight: 1.6 },
  '& table': { borderCollapse: 'collapse', display: 'block', overflowX: 'auto' },
  '& th, & td': { border: `1px solid ${c.outlineVariant}`, px: 1.5, py: 0.75, textAlign: 'left' },
  '& th': { bgcolor: c.surfaceContainer, fontWeight: 700 },
  '& hr': { border: 0, borderTop: `1px solid ${c.outlineVariant}`, my: 3 },
  '& .md-image': {
    display: 'inline-block',
    px: 1,
    py: 0.25,
    borderRadius: `${radius.sm}px`,
    bgcolor: mix(c.primary, 12),
    color: c.onSurfaceVariant,
    fontSize: '0.875em',
  },
  '& input[type=checkbox]': { mr: 1 },
} as const;
