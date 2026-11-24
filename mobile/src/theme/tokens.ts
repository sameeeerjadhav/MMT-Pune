/**
 * Warehouse brand: cool steel blue, clean commerce surfaces.
 * Sora for display, DM Sans for UI (loaded in App.tsx).
 */
export const colors = {
  background: '#F2F5F9',
  backgroundAlt: '#E6ECF3',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F9FC',
  navy: '#0B1F33',
  text: '#152536',
  muted: '#5B6B7C',
  primary: '#1A6BB5',
  primaryDark: '#0F4F8A',
  primarySoft: '#E3EFFA',
  accent: '#C45C28',
  accentSoft: '#F8E9E0',
  success: '#1A8A55',
  successSoft: '#E3F5EC',
  warning: '#B86B12',
  warningSoft: '#FFF3DF',
  danger: '#C03939',
  dangerSoft: '#FBEAEA',
  border: '#D5DEE8',
  borderSoft: '#E8EEF4',
  fifoBg: '#FFF3DF',
  tabInactive: '#7A8A9A',
  overlay: 'rgba(11, 31, 51, 0.45)',
  heroFrom: '#0F4F8A',
  heroTo: '#1A6BB5',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
};

export const shadow = {
  soft: {
    shadowColor: '#0B1F33',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  lift: {
    shadowColor: '#0B1F33',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
};

export const fonts = {
  display: 'Sora_700Bold',
  displaySemi: 'Sora_600SemiBold',
  ui: 'DMSans_400Regular',
  uiMedium: 'DMSans_500Medium',
  uiSemi: 'DMSans_600SemiBold',
  uiBold: 'DMSans_700Bold',
};

export const typography = {
  hero: {
    fontFamily: fonts.display,
    fontSize: 30,
    letterSpacing: -0.8,
    color: colors.navy,
  },
  title: {
    fontFamily: fonts.displaySemi,
    fontSize: 22,
    letterSpacing: -0.4,
    color: colors.navy,
  },
  subtitle: {
    fontFamily: fonts.uiSemi,
    fontSize: 16,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.ui,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  muted: {
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  label: {
    fontFamily: fonts.uiSemi,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    color: colors.muted,
  },
};
