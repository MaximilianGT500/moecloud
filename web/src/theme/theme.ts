import { createTheme, type Shadows } from '@mui/material/styles';
import { FILE_TYPE_COLORS, folderColors, type M3Tokens, type Palette } from './scheme';
import { c, curve, duration, elevation, fonts, layer, mix, radius } from './tokens';

export interface ThemeOptions {
  palette: Palette;
  corners: number;
}

function rgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`;
}

function paletteFor(m: M3Tokens, mode: 'light' | 'dark') {
  const group = (main: string, on: string) => ({ main, contrastText: on });
  return {
    mode,
    primary: group(m.primary, m.onPrimary),
    secondary: group(m.secondary, m.onSecondary),
    error: group(m.error, m.onError),
    warning: group(m.warning, m.onWarning),
    success: group(m.success, m.onSuccess),
    info: group(m.tertiary, m.onTertiary),
    background: { default: m.surface, paper: m.surfaceContainerLow },
    text: { primary: m.onSurface, secondary: m.onSurfaceVariant, disabled: rgba(m.onSurface, 0.38) },
    divider: m.outlineVariant,
    action: {
      active: m.onSurfaceVariant,
      hover: rgba(m.onSurface, 0.08),
      hoverOpacity: 0.08,
      selected: rgba(m.onSurface, 0.1),
      selectedOpacity: 0.1,
      focus: rgba(m.onSurface, 0.1),
      focusOpacity: 0.1,
      disabled: rgba(m.onSurface, 0.38),
      disabledBackground: rgba(m.onSurface, 0.12),
      disabledOpacity: 0.38,
      activatedOpacity: 0.1,
    },
    m3: m,
    fileTypes: { ...FILE_TYPE_COLORS[mode] },
    folders: folderColors(mode === 'dark'),
    Tooltip: { bg: m.inverseSurface },
    SnackbarContent: { bg: m.inverseSurface, color: m.inverseOnSurface },
    Skeleton: { bg: m.surfaceContainerHigh },
    Avatar: { defaultBg: m.secondaryContainer },
    LinearProgress: { primaryBg: m.secondaryContainer, secondaryBg: m.secondaryContainer, errorBg: m.errorContainer },
    Switch: { defaultColor: m.outline, defaultDisabledColor: m.surfaceContainerHighest },
  };
}

const shadows = Array.from({ length: 25 }, (_, index) =>
  index === 0 ? 'none' : elevation[Math.min(5, Math.ceil(index / 3)) as 1 | 2 | 3 | 4 | 5]
) as Shadows;

export function createAppTheme({ palette, corners }: ThemeOptions) {
  const r = (value: number) => (value >= radius.full ? value : Math.round(value * corners));
  return createTheme({
    cssVariables: { colorSchemeSelector: 'data-mui-color-scheme', nativeColor: true },
    defaultColorScheme: 'dark',
    colorSchemes: {
      dark: { palette: paletteFor(palette.dark, 'dark') },
      light: { palette: paletteFor(palette.light, 'light') },
    },
    shape: { borderRadius: r(radius.tile) },
    shadows,
    focusVisible: { outlineColor: c.primary, outlineWidth: 2, outlineOffset: 2 },
    motion: { reducedMotion: 'system' },
    breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
    typography: {
      fontFamily: fonts.sans,
      h1: { fontSize: '2.5rem', lineHeight: 1.2, fontWeight: 800, letterSpacing: '-0.012em' },
      h2: { fontSize: '2rem', lineHeight: 1.25, fontWeight: 800, letterSpacing: '-0.008em' },
      h3: { fontSize: '1.75rem', lineHeight: 1.29, fontWeight: 700 },
      h4: { fontSize: '1.5rem', lineHeight: 1.33, fontWeight: 700 },
      h5: { fontSize: '1.25rem', lineHeight: 1.4, fontWeight: 700 },
      h6: { fontSize: '1.125rem', lineHeight: 1.33, fontWeight: 700 },
      subtitle1: { fontSize: '1rem', lineHeight: 1.5, fontWeight: 500 },
      subtitle2: { fontSize: '0.875rem', lineHeight: 1.43, fontWeight: 700 },
      body1: { fontSize: '1rem', lineHeight: 1.5 },
      body2: { fontSize: '0.875rem', lineHeight: 1.5 },
      caption: { fontSize: '0.75rem', lineHeight: 1.4, letterSpacing: '0.01em' },
      overline: { fontSize: '0.75rem', lineHeight: 1.4, fontWeight: 500, letterSpacing: '0.02em', textTransform: 'none' },
      button: { fontSize: '0.875rem', lineHeight: 1.43, fontWeight: 500, letterSpacing: '0.01em', textTransform: 'none' },
    },
    transitions: {
      easing: { easeInOut: curve.standard, easeOut: curve.enter, easeIn: curve.exit, sharp: curve.standard },
      duration: {
        shortest: duration.shortest,
        shorter: duration.shorter,
        short: duration.short,
        standard: duration.standard,
        complex: duration.complex,
        enteringScreen: duration.enter,
        leavingScreen: duration.exit,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale', textRendering: 'optimizeLegibility' },
          body: { backgroundColor: c.surface, color: c.onSurface, minHeight: '100dvh', overflowX: 'hidden' },
          '::selection': { backgroundColor: mix(c.primary, 32), color: c.onSurface },
          '*': { scrollbarColor: `${c.outlineVariant} transparent`, scrollbarWidth: 'thin' },
          'code, kbd, pre, samp': { fontFamily: fonts.mono },
          '::view-transition-old(root), ::view-transition-new(root)': { animation: 'none', mixBlendMode: 'normal' },
          '::view-transition-new(root)': { zIndex: 9999 },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              scrollBehavior: 'auto !important',
            },
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: { backgroundImage: 'none' }, rounded: { borderRadius: r(radius.md) } },
      },
      MuiButtonBase: { defaultProps: { disableRipple: false } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: radius.full, minHeight: 40, paddingInline: 24, whiteSpace: 'nowrap', fontWeight: 500 },
          sizeSmall: { minHeight: 32, paddingInline: 14, fontSize: '0.8125rem' },
          sizeLarge: { minHeight: 52, paddingInline: 28, fontSize: '0.9375rem' },
          startIcon: { marginLeft: -6, marginRight: 8, '& > *:nth-of-type(1)': { fontSize: 20 } },
          endIcon: { marginRight: -6, marginLeft: 8 },
        },
        variants: [
          { props: { variant: 'text' }, style: { paddingInline: 12 } },
          { props: { variant: 'outlined' }, style: { borderColor: c.outline, '&:hover': { borderColor: c.outline } } },
          {
            props: { variant: 'contained' },
            style: { '@media (hover: hover)': { '&:hover': { boxShadow: elevation[1] } } },
          },
          {
            props: { variant: 'tonal' },
            style: {
              backgroundColor: c.secondaryContainer,
              color: c.onSecondaryContainer,
              '@media (hover: hover)': {
                '&:hover': { backgroundColor: layer(c.secondaryContainer, c.onSecondaryContainer, 8), boxShadow: elevation[1] },
              },
              '&.Mui-disabled': { backgroundColor: mix(c.onSurface, 12), color: mix(c.onSurface, 38) },
            },
          },
        ],
      },
      MuiIconButton: {
        styleOverrides: {
          root: { transition: `background-color 160ms ${curve.standard}, color 160ms ${curve.standard}` },
          sizeSmall: { padding: 6 },
        },
      },
      MuiFab: {
        styleOverrides: {
          root: {
            borderRadius: r(radius.md),
            boxShadow: elevation[3],
            backgroundColor: c.primaryContainer,
            color: c.onPrimaryContainer,
            textTransform: 'none',
            fontWeight: 700,
            '&:hover': { backgroundColor: layer(c.primaryContainer, c.onPrimaryContainer, 8), boxShadow: elevation[4] },
            '&:active': { boxShadow: elevation[3] },
          },
          extended: { height: 56, borderRadius: r(radius.md), paddingInline: 20, gap: 10, fontSize: '0.9375rem' },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: r(radius.xl), backgroundColor: c.surfaceContainerHigh, boxShadow: elevation[3], padding: 8 },
          paperFullScreen: { borderRadius: 0, padding: 0 },
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: '1.5rem', lineHeight: 1.33, fontWeight: 700, padding: '16px 16px 8px' } } },
      MuiDialogContent: { styleOverrides: { root: { padding: '8px 16px', color: c.onSurfaceVariant } } },
      MuiDialogContentText: { styleOverrides: { root: { color: c.onSurfaceVariant, fontSize: '0.875rem', lineHeight: 1.5 } } },
      MuiDialogActions: { styleOverrides: { root: { padding: 16, gap: 8, '& > :not(style) ~ :not(style)': { marginLeft: 0 } } } },
      MuiBackdrop: { styleOverrides: { root: { backgroundColor: mix(c.scrim, 45) }, invisible: { backgroundColor: 'transparent' } } },
      MuiPopover: {
        styleOverrides: { paper: { borderRadius: r(radius.tile), backgroundColor: c.surfaceContainer, boxShadow: elevation[2] } },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { borderRadius: r(radius.tile), backgroundColor: c.surfaceContainer, boxShadow: elevation[2], minWidth: 220 },
          list: { padding: 6 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: r(radius.sm),
            minHeight: 44,
            gap: 12,
            fontSize: '0.875rem',
            paddingInline: 12,
            '&.Mui-selected': { backgroundColor: c.secondaryContainer, color: c.onSecondaryContainer },
          },
        },
      },
      MuiListItemIcon: { styleOverrides: { root: { minWidth: 0, color: c.onSurfaceVariant, '& .MuiSvgIcon-root': { fontSize: 20 } } } },
      MuiListItemText: { styleOverrides: { secondary: { color: c.onSurfaceVariant } } },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: r(radius.tile),
            '&.Mui-selected': {
              backgroundColor: c.secondaryContainer,
              color: c.onSecondaryContainer,
              '&:hover': { backgroundColor: layer(c.secondaryContainer, c.onSecondaryContainer, 8) },
            },
          },
        },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: c.outlineVariant } } },
      MuiTooltip: {
        defaultProps: { enterDelay: 400, enterNextDelay: 150 },
        styleOverrides: {
          tooltip: {
            backgroundColor: c.inverseSurface,
            color: c.inverseOnSurface,
            fontSize: '0.75rem',
            fontWeight: 500,
            borderRadius: r(radius.sm),
            padding: '6px 10px',
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: r(radius.sm), height: 32, fontWeight: 500, fontSize: '0.875rem' },
          label: { paddingInline: 12 },
          outlined: { borderColor: c.outlineVariant },
          sizeSmall: { height: 24, fontSize: '0.75rem' },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: r(radius.tile),
            '& .MuiOutlinedInput-notchedOutline': { borderColor: c.outline },
            '&:hover:not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: c.onSurface },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: c.primary, borderWidth: 2 },
          },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { color: c.onSurfaceVariant, '&.Mui-focused': { color: c.primary } } } },
      MuiFormHelperText: { styleOverrides: { root: { marginInline: 16 } } },
      MuiTabs: { styleOverrides: { root: { minHeight: 48 }, indicator: { height: 3, borderRadius: '3px 3px 0 0' } } },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.875rem',
            minHeight: 48,
            paddingInline: 16,
            color: c.onSurfaceVariant,
          },
        },
      },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: radius.full, height: 4 }, bar: { borderRadius: radius.full } } },
      MuiSkeleton: { styleOverrides: { root: { backgroundColor: c.surfaceContainerHigh }, rounded: { borderRadius: r(radius.tile) } } },
      MuiAvatar: {
        styleOverrides: {
          root: { fontWeight: 700, fontSize: '0.9375rem' },
          colorDefault: { backgroundColor: c.secondaryContainer, color: c.onSecondaryContainer },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: r(radius.tile),
            alignItems: 'center',
            variants: [
              {
                props: { variant: 'standard', severity: 'error' },
                style: { backgroundColor: c.errorContainer, color: c.onErrorContainer, '& .MuiAlert-icon': { color: c.error } },
              },
              {
                props: { variant: 'standard', severity: 'warning' },
                style: { backgroundColor: c.warningContainer, color: c.onWarningContainer, '& .MuiAlert-icon': { color: c.warning } },
              },
              {
                props: { variant: 'standard', severity: 'success' },
                style: { backgroundColor: c.successContainer, color: c.onSuccessContainer, '& .MuiAlert-icon': { color: c.success } },
              },
              {
                props: { variant: 'standard', severity: 'info' },
                style: { backgroundColor: c.secondaryContainer, color: c.onSecondaryContainer, '& .MuiAlert-icon': { color: c.secondary } },
              },
            ],
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { borderRadius: radius.full },
          firstButton: { borderTopLeftRadius: radius.full, borderBottomLeftRadius: radius.full, paddingLeft: 16 },
          lastButton: { borderTopRightRadius: radius.full, borderBottomRightRadius: radius.full, paddingRight: 16 },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            borderColor: c.outline,
            color: c.onSurface,
            paddingBlock: 6,
            paddingInline: 12,
            gap: 6,
            '&.Mui-selected': {
              backgroundColor: c.secondaryContainer,
              color: c.onSecondaryContainer,
              '&:hover': { backgroundColor: layer(c.secondaryContainer, c.onSecondaryContainer, 8) },
            },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: { width: 64, height: 44, padding: 8 },
          switchBase: {
            padding: 12,
            '&.Mui-checked': {
              transform: 'translateX(20px)',
              color: c.onPrimary,
              '& + .MuiSwitch-track': { backgroundColor: c.primary, opacity: 1, borderColor: c.primary },
              '& .MuiSwitch-thumb': { width: 24, height: 24, margin: -2, backgroundColor: c.onPrimary },
            },
            '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.38 },
          },
          thumb: {
            width: 16,
            height: 16,
            margin: 2,
            boxShadow: 'none',
            backgroundColor: c.outline,
            transition: `all 200ms ${curve.standard}`,
          },
          track: {
            borderRadius: radius.full,
            backgroundColor: c.surfaceContainerHighest,
            border: `2px solid ${c.outline}`,
            opacity: 1,
            boxSizing: 'border-box',
          },
        },
      },
      MuiCheckbox: { styleOverrides: { root: { color: c.onSurfaceVariant } } },
      MuiSnackbarContent: { styleOverrides: { root: { borderRadius: r(radius.tile) } } },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none', backgroundColor: c.surfaceContainerLow } } },
      MuiBadge: { styleOverrides: { badge: { fontWeight: 700 } } },
    },
  });
}
