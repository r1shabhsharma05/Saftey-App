/**
 * Floxly-style auth design tokens — bright blue gradient aesthetic
 * adapted for SafeLife AI. Matches the reference: vivid blue gradient
 * backgrounds, dark pill inputs, blue→cyan gradient CTAs.
 */
export const Floxly = {
  gradients: {
    /** Main auth background: bright sky blue → deep navy */
    background: ['#63aef2', '#3a86d8', '#1a4b9e', '#0a1e46'] as [
      string,
      string,
      string,
      string,
    ],
    /** CTA button: bright blue → cyan (like the photo's Log In button) */
    cta: ['#4a9eff', '#22d3ee'] as [string, string],
    /** Logo glow ring */
    logoRing: ['#7cc4ff', '#2b7cd3'] as [string, string],
  },
  colors: {
    /** Dark translucent pill (inputs, social buttons) */
    pill: 'rgba(8, 18, 38, 0.55)',
    pillBorder: 'rgba(255, 255, 255, 0.14)',
    pillPlaceholder: 'rgba(255, 255, 255, 0.45)',
    heading: '#ffffff',
    subtext: 'rgba(255, 255, 255, 0.72)',
    faint: 'rgba(255, 255, 255, 0.5)',
    accent: '#22d3ee',
    divider: 'rgba(255, 255, 255, 0.25)',
  },
  fonts: {
    /** Reuse the app's loaded fonts */
    headline: 'SpaceGrotesk_700Bold',
    title: 'SpaceGrotesk_600SemiBold',
    body: 'Manrope_400Regular',
    bodyBold: 'Manrope_700Bold',
    label: 'Manrope_600SemiBold',
  },
} as const;
