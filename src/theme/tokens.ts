/**
 * Stockpot's palette. Two rules hold the visual system together:
 *
 *  1. The freshness ramp (fresh / soon / urgent / gone) is semantic. Nothing
 *     that is not a stock state may use those four colours.
 *  2. Every colour is defined for both schemes. A value that exists in only
 *     one is the classic unreadable-in-dark-mode bug.
 */

export type Scheme = 'light' | 'dark';

export type Tokens = {
  ground: string;
  surface: string;
  surfaceAlt: string;
  sunk: string;
  ink: string;
  inkMuted: string;
  inkFaint: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentText: string;
  accentWash: string;
  fresh: string;
  freshWash: string;
  soon: string;
  soonWash: string;
  urgent: string;
  urgentWash: string;
  gone: string;
  goneWash: string;
};

const light: Tokens = {
  ground: '#F5F6F2',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEEE7',
  sunk: '#E4E7DF',
  ink: '#131A17',
  inkMuted: '#4E5B55',
  inkFaint: '#79867F',
  line: '#DBE0D7',
  lineStrong: '#C6CDC1',
  accent: '#10453C',
  accentText: '#1C6E5F',
  accentWash: '#E3EFE9',
  fresh: '#2F7D4F',
  freshWash: '#E2F0E5',
  soon: '#9A700A',
  soonWash: '#F6EDD5',
  urgent: '#B9521C',
  urgentWash: '#F8E7DA',
  gone: '#A2312D',
  goneWash: '#F7E1DF',
};

const dark: Tokens = {
  ground: '#0E1312',
  surface: '#161D1B',
  surfaceAlt: '#1D2624',
  sunk: '#121917',
  ink: '#E7ECE9',
  inkMuted: '#A4B1AC',
  inkFaint: '#7C8983',
  line: '#28322F',
  lineStrong: '#374340',
  accent: '#7ED8C0',
  accentText: '#A6E6D4',
  accentWash: '#17302B',
  fresh: '#66C68A',
  freshWash: '#17301F',
  soon: '#DDB142',
  soonWash: '#302816',
  urgent: '#EF9257',
  urgentWash: '#332115',
  gone: '#ED7B76',
  goneWash: '#331B1A',
};

export const themes: Record<Scheme, Tokens> = { light, dark };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 2, md: 6, lg: 10 } as const;

export const type = {
  display: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  body: { fontSize: 16, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  meta: { fontSize: 12, fontWeight: '500', letterSpacing: 0.3 },
  mono: { fontSize: 13, fontVariant: ['tabular-nums'] },
} as const;
