import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle } from 'react-native';
import { Text } from '@/components/ui/text';

import { radius, space, type as type_, type Tokens } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** One place icons come from, so sizes and colours stay consistent. */
export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  const t = useTokens();
  return <Ionicons name={name} size={size} color={color ?? t.inkMuted} />;
}

/* ------------------------------------------------------------------ text -- */

export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTokens();
  return <Text style={[type_.display, { color: t.ink }, style]}>{children}</Text>;
}

export function Body({ children, muted = true }: { children: ReactNode; muted?: boolean }) {
  const t = useTokens();
  return <Text style={[type_.body, { color: muted ? t.inkMuted : t.ink }]}>{children}</Text>;
}

/** Uppercase section label. */
export function Eyebrow({ children, color }: { children: ReactNode; color?: string }) {
  const t = useTokens();
  return (
    <Text style={[type_.label, { textTransform: 'uppercase', color: color ?? t.inkFaint }]}>
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
        flexDirection: 'row',
        gap: space.md,
        alignItems: 'flex-start',
        backgroundColor: t.goneWash,
        borderRadius: radius.md,
        paddingVertical: space.md,
        paddingHorizontal: space.lg }}>
      <Ionicons name="alert-circle" size={18} color={t.gone} style={{ marginTop: 1 }} />
      <Text style={[type_.small, { color: t.gone, flex: 1 }]}>{message}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- button -- */

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = 'primary', icon, disabled, busy, style }: ButtonProps) {
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
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: variant === 'ghost' ? 0 : StyleSheet.hairlineWidth * 2,
          borderRadius: radius.md,
          paddingVertical: 15,
          paddingHorizontal: space.xl,
          opacity: inactive ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !inactive ? 0.985 : 1 }] },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={17} color={palette.fg} /> : null}
          <Text style={{ fontFamily: type_.item.fontFamily, fontSize: 15.5, color: palette.fg }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function buttonPalette(t: Tokens, variant: NonNullable<ButtonProps['variant']>) {
  switch (variant) {
    case 'primary':
      return { bg: t.accent, fg: t.onAccent, border: t.accent };
    case 'secondary':
      return { bg: t.surface, fg: t.ink, border: t.lineStrong };
    case 'danger':
      return { bg: t.goneWash, fg: t.gone, border: t.goneWash };
    case 'ghost':
      return { bg: 'transparent', fg: t.accentText, border: 'transparent' };
  }
}

/* ----------------------------------------------------------------- input -- */

type FieldProps = TextInputProps & {
  label: string;
  hint?: string;
  suffix?: string;
  icon?: IconName;
};

export function Field({ label, hint, suffix, icon, style, ...props }: FieldProps) {
  const t = useTokens();
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Eyebrow>{label}</Eyebrow> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          backgroundColor: t.surface,
          borderColor: t.line,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.md,
          paddingHorizontal: space.lg }}>
        {icon ? <Ionicons name={icon} size={17} color={t.inkFaint} /> : null}
        <TextInput
          placeholderTextColor={t.inkFaint}
          {...props}
          style={[{ flex: 1, paddingVertical: 14, fontFamily: type_.body.fontFamily, fontSize: 15.5, color: t.ink }, style]}
        />
        {suffix ? <Text style={[type_.meta, { color: t.inkFaint }]}>{suffix}</Text> : null}
      </View>
      {hint ? <Text style={[type_.small, { color: t.inkFaint, fontSize: 12.5 }]}>{hint}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------- selection -- */

export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange }: {
  label?: string;
  options: { value: T; label: string; icon?: IconName }[];
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
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 10,
                paddingHorizontal: space.lg,
                borderRadius: radius.pill,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: active ? t.accent : t.line,
                backgroundColor: active ? t.accentWash : t.surface }}>
              {option.icon ? (
                <Ionicons name={option.icon} size={15} color={active ? t.accentText : t.inkFaint} />
              ) : null}
              <Text
                style={{
                  fontFamily: active ? type_.item.fontFamily : type_.body.fontFamily,
                  fontSize: 14,
                  color: active ? t.accentText : t.inkMuted }}>
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
  onChange }: {
  label?: string;
  hint?: string;
  options: readonly T[];
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
              onPress={() => onChange(active ? values.filter((v) => v !== option) : [...values, option])}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                paddingVertical: 9,
                paddingHorizontal: space.md + 2,
                borderRadius: radius.pill,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: active ? t.accent : t.line,
                backgroundColor: active ? t.accentWash : t.surface }}>
              {active ? <Ionicons name="checkmark" size={14} color={t.accentText} /> : null}
              <Text
                style={{
                  fontFamily: active ? type_.item.fontFamily : type_.body.fontFamily,
                  fontSize: 13.5,
                  color: active ? t.accentText : t.inkMuted }}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text style={[type_.small, { color: t.inkFaint, fontSize: 12.5 }]}>{hint}</Text> : null}
    </View>
  );
}

/* -------------------------------------------------------------- surfaces -- */

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTokens();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderColor: t.line,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.lg,
          padding: space.xl },
        style,
      ]}>
      {children}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  icon = 'basket-outline',
  action }: {
  title: string;
  body: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  const t = useTokens();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: space.xl, gap: space.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          backgroundColor: t.accentWash,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: space.xs }}>
        <Ionicons name={icon} size={28} color={t.accentText} />
      </View>
      <Text style={[type_.title, { color: t.ink, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type_.body, { color: t.inkMuted, textAlign: 'center', maxWidth: 320 }]}>{body}</Text>
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
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
