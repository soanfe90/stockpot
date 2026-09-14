import { Text as RNText, type TextProps } from 'react-native';

import { fonts } from '@/theme/tokens';

/**
 * Text with the app's face already on it.
 *
 * Imported in place of React Native's Text so a screen cannot silently fall
 * back to the system font by forgetting a fontFamily. Anything passed in style
 * still wins, so a heading can ask for the display face as usual.
 */
export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={[{ fontFamily: fonts.body }, style]} />;
}
