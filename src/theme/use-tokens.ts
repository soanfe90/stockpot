import { useColorScheme } from '@/hooks/use-color-scheme';

import { themes, type Tokens } from './tokens';

/** Reads the viewer's scheme through the hydration-safe hook, so a statically
 *  rendered web page does not flash the wrong palette. */
export function useTokens(): Tokens {
  const scheme = useColorScheme();
  return themes[scheme === 'dark' ? 'dark' : 'light'];
}

export type { Tokens };
