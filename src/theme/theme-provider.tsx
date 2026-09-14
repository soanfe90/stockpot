import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';

import { themes, type Scheme, type Tokens } from './tokens';

/**
 * Appearance, in three states rather than two: the two explicit choices, plus
 * following the phone. "System" is the default because a phone-wide dark mode
 * at night is a setting people have already made once.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'stockpot.appearance';

type ThemeContextValue = {
  /** What the user chose. */
  mode: ThemeMode;
  /** What that resolves to right now. */
  scheme: Scheme;
  tokens: Tokens;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useSystemScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Read the stored choice after first paint rather than blocking on it. The
  // default is "system", which is already the right answer for most people, so
  // there is nothing to flash.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (active && (stored === 'light' || stored === 'dark' || stored === 'system')) {
          setModeState(stored);
        }
      })
      .catch(() => {
        // A device that cannot read storage still gets a working theme.
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // The choice still applies for this session.
    });
  }, []);

  const scheme: Scheme = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, tokens: themes[scheme], setMode }),
    [mode, scheme, setMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** The colours for the active scheme. What almost every component wants. */
export function useTokens(): Tokens {
  return useTheme().tokens;
}

/** The chosen mode and a setter, for the appearance control. */
export function useThemeMode(): Pick<ThemeContextValue, 'mode' | 'scheme' | 'setMode'> {
  const { mode, scheme, setMode } = useTheme();
  return { mode, scheme, setMode };
}
