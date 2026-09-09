import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { radius, space, type Tokens } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

/* ------------------------------------------------------------------ text -- */

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return (
    <Text style={[{ fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: t.ink }, style as never]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted = true }: { children: ReactNode; muted?: boolean }) {
  const t = useTokens();
  return <Text style={{ fontSize: 15, lineHeight: 22, color: muted ? t.inkMuted : t.ink }}>{children}</Text>;
}

/** Uppercase mono label. Used for section headers and field captions. */
export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  const t = useTokens();
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        color: color ?? t.inkFaint,
      }}>
      {children}
    </Text>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  const t = useTokens();
  if (!message) return null;
  return (
    <View
      style={{
        backgroundColor: t.goneWash,
        borderRadius: radius.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
      }}>
      <Text style={{ color: t.gone, fontSize: 14, lineHeight: 20 }}>{message}</Text>
    </View>
  );
}

/* --------------------------------------------------------------- button -- */

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = 'primary', disabled, busy, style }: ButtonProps) {
  const t = useTokens();
  const palette = buttonPalette(t, variant);
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.md,
          paddingVertical: 14,
          paddingHorizontal: space.lg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.5 : pressed ? 0.82 : 1,
        },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={{ color: palette.fg, fontWeight: '600', fontSize: 15 }}>{label}</Text>
      )}
    </Pressable>
  );
}

function buttonPalette(t: Tokens, variant: NonNullable<ButtonProps['variant']>) {
  switch (variant) {
    case 'primary':
      return { bg: t.accent, fg: t.ground, border: t.accent };
    case 'secondary':
      return { bg: t.surface, fg: t.ink, border: t.lineStrong };
    case 'danger':
      return { bg: t.goneWash, fg: t.gone, border: t.goneWash };
    case 'ghost':
      return { bg: 'transparent', fg: t.accentText, border: 'transparent' };
  }
}

/* ---------------------------------------------------------------- input -- */

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  suffix?: string;
};

export function Field({ label, hint, suffix, style, ...props }: FieldProps) {
  const t = useTokens();
  return (
    <View style={{ gap: space.sm }}>
      <Eyebrow>{label}</Eyebrow>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: t.surface,
          borderColor: t.line,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
        }}>
        <TextInput
          placeholderTextColor={t.inkFaint}
          {...props}
          style={[{ flex: 1, paddingVertical: 13, fontSize: 16, color: t.ink }, style]}
        />
        {suffix ? <Text style={{ color: t.inkFaint, fontSize: 14, marginLeft: space.sm }}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>{hint}</Text> : null}
    </View>
  );
}

/* ----------------------------------------------------------- segmented -- */

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const t = useTokens();
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(option.value)}
              style={{
                paddingVertical: 9,
                paddingHorizontal: space.md,
                borderRadius: radius.sm,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: active ? t.accent : t.line,
                backgroundColor: active ? t.accentWash : t.surface,
              }}>
              <Text style={{ fontSize: 14, fontWeight: active ? '600' : '400', color: active ? t.accentText : t.inkMuted }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Multi-select. Same shape as Segmented, but any number can be on at once. */
export function Chips<T extends string>({
  label,
  hint,
  options,
  values,
  onChange,
}: {
  label?: string;
  hint?: string;
  options: T[];
  values: T[];
  onChange: (values: T[]) => void;
}) {
  const t = useTokens();
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {options.map((option) => {
          const active = values.includes(option);
          return (
            <Pressable
              key={option}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              onPress={() =>
                onChange(active ? values.filter((v) => v !== option) : [...values, option])
              }
              style={{
                paddingVertical: 8,
                paddingHorizontal: space.md,
                borderRadius: radius.sm,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: active ? t.accent : t.line,
                backgroundColor: active ? t.accentWash : t.surface,
              }}>
              <Text style={{ fontSize: 13.5, color: active ? t.accentText : t.inkMuted, fontWeight: active ? '600' : '400' }}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>{hint}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------- surfaces -- */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderColor: t.line,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.md,
          padding: space.lg,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  const t = useTokens();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: space.xl, gap: space.md }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: t.ink, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontSize: 14, lineHeight: 21, color: t.inkMuted, textAlign: 'center', maxWidth: 320 }}>{body}</Text>
      {action}
    </View>
  );
}

export function Loading() {
  const t = useTokens();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.ground }}>
      <ActivityIndicator color={t.accentText} />
    </View>
  );
}
