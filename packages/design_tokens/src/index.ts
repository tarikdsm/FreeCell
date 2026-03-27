export const tokens = {
  color: {
    surface: '#0e4f3a',
    surfaceElevated: '#154f43',
    panel: '#f5f1e8',
    ink: '#15211a',
    accent: '#d8c36a',
    accentStrong: '#f0de90',
    shadow: 'rgba(7, 18, 13, 0.22)',
    red: '#b63a46',
    black: '#1b2732',
    outline: 'rgba(255, 255, 255, 0.16)',
  },
  spacing: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 24,
    pill: 999,
  },
  motion: {
    quick: 120,
    standard: 220,
    slow: 360,
  },
  card: {
    width: 128,
    height: 180,
    fanOffset: 38,
  },
} as const;

export type DesignTokens = typeof tokens;
