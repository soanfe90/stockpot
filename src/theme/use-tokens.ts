/**
 * Kept as the import path the app already uses everywhere. The implementation
 * lives with the provider, because the active scheme is now a user choice and
 * not just a reading of the system setting.
 */
export { useThemeMode, useTokens } from './theme-provider';
export type { Tokens } from './tokens';
