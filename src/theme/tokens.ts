/**
 * Stockpot's design tokens.
 *
 * The palette is built around one constraint that is easy to miss: the
 * freshness ramp (fresh / soon / urgent / gone) is *semantic* and carries the
 * whole point of the app, so it owns green, amber, orange and red. A brand
 * colour drawn from those hues would be permanently ambiguous with a stock
 * state.
 *
 * That rules out the obvious food greens and oranges and pushes to the other
 * half of the food palette -- fig, berry, aubergine, wine. Warm, appetising,
 * and unmistakably not a warning.
 *
 * Rules that hold everywhere:
 *  - Every colour is defined for both schemes. A value present in only one is
 *    a bug.
 *  - The ramp means stock state and nothing else.
 */

import type { TextStyle } from 'react-native';

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
  onAccent: string;
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
  // Warm paper with a rose bias, so the neutral belongs to the accent rather
  // than sitting next to it.
  ground: '#FBF7F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F4ECE8',
  sunk: '#EDE3DE',
  ink: '#241A20',
  inkMuted: '#6B5A63',
  inkFaint: '#9A8891',
  line: '#E9DED8',
  lineStrong: '#D5C5BD',
  accent: '#7C2F50',
  accentText: '#98395F',
  accentWash: '#F8E9EE',
  onAccent: '#FFF6F9',
  fresh: '#3E7D45',
  freshWash: '#E6F1E5',
  soon: '#9E7213',
  soonWash: '#F8EFDA',
  urgent: '#C1571E',
  urgentWash: '#FCE8DA',
  gone: '#AD2F30',
  goneWash: '#FBE3E1',
};

const dark: Tokens = {
  ground: '#171114',
  surface: '#1F1821',
  surfaceAlt: '#2A1F2A',
  sunk: '#120D10',
  ink: '#F3EAEE',
  inkMuted: '#B7A5AF',
  inkFaint: '#8B7884',
  line: '#33262F',
  lineStrong: '#46353F',
  // The accent flips light on a dark ground: the same berry, lifted so it
  // still reads as the brand rather than as a shadow.
  accent: '#EE9BBA',
  accentText: '#F3B0CB',
  accentWash: '#2E1B25',
  onAccent: '#2A1019',
  fresh: '#7DC582',
  freshWash: '#1C2E1D',
  soon: '#E1B54D',
  soonWash: '#312715',
  urgent: '#F4965B',
  urgentWash: '#351F10',
  gone: '#F17B77',
  goneWash: '#341818',
};

export const themes: Record<Scheme, Tokens> = { light, dark };

/* ------------------------------------------------------------------ type -- */

/**
 * Two faces, each doing one job. Fraunces is a warm old-style serif with soft
 * terminals -- it carries the app's character in headings. Figtree is a
 * geometric humanist sans that stays legible at the sizes an inventory list
 * actually uses.
 */
export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  body: 'Figtree_400Regular',
  medium: 'Figtree_500Medium',
  semibold: 'Figtree_600SemiBold',
  bold: 'Figtree_700Bold',
} as const;

export const type = {
  /** Screen titles. */
  display: { fontFamily: fonts.displayBold, fontSize: 28, lineHeight: 33, letterSpacing: -0.4 },
  /** Card and section headings. */
  title: { fontFamily: fonts.display, fontSize: 19, lineHeight: 24, letterSpacing: -0.2 },
  /** Names in a list -- the thing being scanned for. */
  item: { fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 20 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  /** Uppercase section labels. */
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 1.1 },
  meta: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 17 },
  /** Quantities. Tabular figures so columns of numbers line up -- typed as a
   *  style rather than frozen, because `as const` would make fontVariant a
   *  readonly tuple that React Native's TextStyle will not accept. */
  figure: { fontFamily: fonts.semibold, fontSize: 14.5, fontVariant: ['tabular-nums'] } as TextStyle,
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 } as const;
