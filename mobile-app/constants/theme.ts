/**
 * The Guardian Pulse — Premium Design System
 * Tactical Safety UI Tokens (v2: 3D glass, glow, motion-ready)
 */

export const Theme = {
  colors: {
    primary: '#81ecff',
    primaryContainer: '#00e3fd',
    primaryFixedDim: '#00d4ec',
    onPrimaryFixed: '#003840',
    surface: '#0c0c1d',
    surfaceDim: '#0c0c1d',
    surfaceBright: '#2a2a43',
    surfaceContainer: '#18182b',
    surfaceContainerLow: '#121223',
    surfaceContainerHigh: '#1d1d33',
    surfaceContainerHighest: '#24233b',
    onSurface: '#e6e3fb',
    onSurfaceVariant: '#aba9bf',
    secondary: '#699cff',
    secondaryContainer: '#005ac2',
    tertiary: '#ff7168',
    tertiaryContainer: '#f53335',
    error: '#ff716c',
    errorContainer: '#9f0519',
    outline: '#757388',
    outlineVariant: '#474659',
    inverseSurface: '#fcf8ff',
    inverseOnSurface: '#545366',
    success: '#00ff88',
    successDim: '#00cc6a',
    warning: '#ffc107',
    police: '#4a90e2',
    university: '#9b51e0',
    hostel: '#f2994a',
  },
  /** Gradient presets — pass straight into expo-linear-gradient */
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
  /** Glow shadow presets */
  glow: {
    primary: 'rgba(0, 227, 253, 0.35)',
    softPrimary: 'rgba(0, 227, 253, 0.16)',
    danger: 'rgba(245, 51, 53, 0.4)',
    success: 'rgba(0, 255, 136, 0.35)',
    police: 'rgba(74, 144, 226, 0.35)',
  },
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
  /** Safe-place category → accent color + icon (single source of truth) */
  category: {
    police: { color: '#4a90e2', icon: 'police-badge' },
    hospital: { color: '#ff7168', icon: 'hospital-box' },
    university: { color: '#9b51e0', icon: 'school' },
    hostel: { color: '#f2994a', icon: 'bed' },
    crowd: { color: '#81ecff', icon: 'map-marker-radius' },
    other: { color: '#aba9bf', icon: 'map-marker' },
  } as Record<string, { color: string; icon: string }>,
};

export const categoryMeta = (category?: string) =>
  Theme.category[category ?? 'other'] ?? Theme.category.other;

export const Colors = {
  light: {
    text: '#11181C',
    background: '#fff',
    tint: '#81ecff',
    icon: '#687076',
    tabIconDefault: '#687076',
    tabIconSelected: '#81ecff',
  },
  dark: {
    text: '#ECEDEE',
    background: '#0c0c1d',
    tint: '#00e3fd',
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: '#00e3fd',
  },
};
