/**
 * SafeLife — Apple design tokens (HIG).
 *
 * Semantic iOS colors in two appearances. The dashboard follows the
 * device scheme: `Theme.colors` resolves at read time from
 * `Appearance.getColorScheme()` (light returns the light palette,
 * anything else — including unknown — returns dark, the app's home
 * look). Styles are created once per module load, so a scheme change
 * mid-session applies on the next reload — that is the known limit of
 * this token layer, not a bug in any screen.
 *
 * Rules (dickwu apple-design-skill: color.md, typography.md,
 * dark-mode.md): system font only — `Theme.type` carries NO
 * fontFamily, so iOS renders SF Pro and Android its system font.
 * One accent (system blue); red is reserved for SOS / destructive.
 * Colours are data, never chrome: category colours live on the map
 * data, never on chrome.
 *
 * Back-compat: `fonts`, `gradients` and `glow` stay exported
 * untouched — the auth flow (AuthTheme screens, OtpCubes,
 * BiometricLockScreen) and app/guardian.tsx still use them. The
 * dashboard no longer reads them.
 */
import { Appearance } from 'react-native';
import type { TextStyle } from 'react-native';

type Palette = {
  primary: string;
  /** Blue for small text on cards and on tints (primary itself fails 4.5:1 there — verified in contrast_check.py). */
  primaryText: string;
  /** Filled-button blue: white text on it passes 4.5:1 in both modes (primary itself does not). */
  primaryFill: string;
  primaryContainer: string;
  primaryFixedDim: string;
  onPrimary: string;
  onPrimaryFixed: string;
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainer: string;
  surfaceContainerLow: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  onSurface: string;
  onSurfaceVariant: string;
  secondary: string;
  secondaryContainer: string;
  tertiary: string;
  tertiaryContainer: string;
  error: string;
  /** Red for small text on cards (system red fails 4.5:1 on white). */
  errorText: string;
  /** Filled-button / SOS red: white text on it passes 4.5:1 in both modes. */
  errorFill: string;
  errorContainer: string;
  success: string;
  /** Green for small text on cards (system green is 2.2:1 on white). */
  successText: string;
  successContainer: string;
  successDim: string;
  warning: string;
  /** Amber for small text on cards (system amber is 2.2:1 on white). */
  warningText: string;
  warningContainer: string;
  outline: string;
  outlineVariant: string;
  separator: string;
  systemFill: string;
  inverseSurface: string;
  inverseOnSurface: string;
  police: string;
  hospital: string;
  university: string;
  hostel: string;
  crowd: string;
};

// iOS semantic colours — light appearance.
const lightColors: Palette = {
  primary: '#007AFF',
  primaryText: '#0057D9',
  primaryFill: '#0066CC',
  primaryContainer: 'rgba(0, 122, 255, 0.12)',
  primaryFixedDim: '#007AFF',
  onPrimary: '#FFFFFF',
  onPrimaryFixed: '#FFFFFF',
  surface: '#F2F2F7',
  surfaceDim: '#F2F2F7',
  surfaceBright: '#FFFFFF',
  surfaceContainer: '#FFFFFF',
  surfaceContainerLow: '#F2F2F7',
  surfaceContainerHigh: '#E5E5EA',
  surfaceContainerHighest: '#D1D1D6',
  onSurface: '#000000',
  onSurfaceVariant: 'rgba(60, 60, 67, 0.75)',
  secondary: '#8E8E93',
  secondaryContainer: 'rgba(142, 142, 147, 0.15)',
  tertiary: '#FF3B30',
  tertiaryContainer: 'rgba(255, 59, 48, 0.12)',
  error: '#FF3B30',
  errorText: '#D70015',
  errorFill: '#D70015',
  errorContainer: 'rgba(255, 59, 48, 0.12)',
  success: '#34C759',
  successText: '#1E7B34',
  successContainer: 'rgba(52, 199, 89, 0.12)',
  successDim: '#34C759',
  warning: '#FF9500',
  warningText: '#8A5A00',
  warningContainer: 'rgba(255, 149, 0, 0.12)',
  outline: 'rgba(60, 60, 67, 0.29)',
  outlineVariant: '#C6C6C8',
  separator: 'rgba(60, 60, 67, 0.29)',
  systemFill: 'rgba(120, 120, 128, 0.20)',
  inverseSurface: '#1C1C1E',
  inverseOnSurface: '#FFFFFF',
  police: '#007AFF',
  hospital: '#FF3B30',
  university: '#AF52DE',
  hostel: '#FF9500',
  crowd: '#30B0C7',
};

// iOS semantic colours — dark appearance (the app's home look).
const darkColors: Palette = {
  primary: '#0A84FF',
  primaryText: '#5EAFFF',
  primaryFill: '#0066CC',
  primaryContainer: 'rgba(10, 132, 255, 0.15)',
  primaryFixedDim: '#0A84FF',
  onPrimary: '#FFFFFF',
  onPrimaryFixed: '#FFFFFF',
  surface: '#000000',
  surfaceDim: '#000000',
  surfaceBright: '#2C2C2E',
  surfaceContainer: '#1C1C1E',
  surfaceContainerLow: '#2C2C2E',
  surfaceContainerHigh: '#3A3A3C',
  surfaceContainerHighest: '#48484A',
  onSurface: '#FFFFFF',
  onSurfaceVariant: 'rgba(235, 235, 245, 0.6)',
  secondary: '#98989D',
  secondaryContainer: 'rgba(152, 152, 157, 0.15)',
  tertiary: '#FF453A',
  tertiaryContainer: 'rgba(255, 69, 58, 0.15)',
  error: '#FF453A',
  errorText: '#FF453A',
  errorFill: '#D70015',
  errorContainer: 'rgba(255, 69, 58, 0.12)',
  success: '#30D158',
  successText: '#30D158',
  successContainer: 'rgba(48, 209, 88, 0.12)',
  successDim: '#30D158',
  warning: '#FF9F0A',
  warningText: '#FF9F0A',
  warningContainer: 'rgba(255, 159, 10, 0.12)',
  outline: 'rgba(84, 84, 88, 0.6)',
  outlineVariant: '#38383A',
  separator: 'rgba(84, 84, 88, 0.6)',
  systemFill: 'rgba(120, 120, 128, 0.36)',
  inverseSurface: '#F2F2F7',
  inverseOnSurface: '#000000',
  police: '#0A84FF',
  hospital: '#FF453A',
  university: '#BF5AF2',
  hostel: '#FF9F0A',
  crowd: '#40C8E0',
};

/** HIG built-in text styles (typography.md). System font: no fontFamily. */
const typeScale: Record<string, TextStyle> = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: -0.4 },
  title1: { fontSize: 28, fontWeight: '700', letterSpacing: -0.3 },
  title2: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  title3: { fontSize: 20, fontWeight: '600' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17, fontWeight: '400' },
  callout: { fontSize: 16, fontWeight: '400' },
  subhead: { fontSize: 15, fontWeight: '400' },
  footnote: { fontSize: 13, fontWeight: '400' },
  caption1: { fontSize: 12, fontWeight: '400' },
  caption2: { fontSize: 11, fontWeight: '400' },
};

export const Theme = {
  /** Scheme-aware palette — see the header comment. */
  get colors(): Palette {
    return Appearance.getColorScheme() === 'light' ? lightColors : darkColors;
  },
  /** HIG text styles. Spread, then override fontSize where a screen needs it. */
  type: typeScale,
  /** Gradient presets — kept for the guardian flow + GlowButton (auth-era). The dashboard does not use gradients. */
  gradients: {
    primary: ['#81ecff', '#00e3fd'] as [string, string],
    primaryDeep: ['#00e3fd', '#005a70'] as [string, string],
    danger: ['#ff7168', '#f53335'] as [string, string],
    success: ['#00ff88', '#00cc6a'] as [string, string],
    sosCore: ['#16233d', '#0c0c1d'] as [string, string],
    glassSheen: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0)'] as [string, string],
    card: ['#262640', '#18182b'] as [string, string],
    background: ['#0c0c1d', '#0c0c1d'] as [string, string],
  },
  /** Glow shadow presets — kept for GlowButton (guardian flow). The dashboard is flat: no glows. */
  glow: {
    primary: 'rgba(0, 227, 253, 0.35)',
    softPrimary: 'rgba(0, 227, 253, 0.16)',
    danger: 'rgba(245, 51, 53, 0.4)',
    success: 'rgba(0, 255, 136, 0.35)',
    police: 'rgba(74, 144, 226, 0.35)',
  },
  /** Display fonts — kept for the auth flow + AppDialog. The dashboard uses the system font (Theme.type). */
  fonts: {
    headline: 'SpaceGrotesk_700Bold',
    label: 'SpaceGrotesk_500Medium',
    body: 'Manrope_400Regular',
    bodyBold: 'Manrope_700Bold',
  },
  roundness: {
    sm: 12,
    default: 16,
    lg: 24,
    xl: 32,
    full: 9999,
  },
  spacing: {
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
  },
  /** Safe-place category → accent color + Ionicons name (single source of truth). Colours are data, not chrome. */
  category: {
    police: { color: '#007AFF', icon: 'shield' },
    hospital: { color: '#FF3B30', icon: 'medkit' },
    university: { color: '#AF52DE', icon: 'school' },
    hostel: { color: '#FF9500', icon: 'bed' },
    crowd: { color: '#30B0C7', icon: 'location' },
    other: { color: '#8E8E93', icon: 'location' },
  } as Record<string, { color: string; icon: string }>,
};

export const categoryMeta = (category?: string) =>
  Theme.category[category ?? 'other'] ?? Theme.category.other;

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: '#007AFF',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: '#007AFF',
  },
  dark: {
    text: '#ECEDEE',
    background: '#000000',
    tint: '#0A84FF',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#0A84FF',
  },
};
