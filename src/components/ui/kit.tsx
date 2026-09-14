import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
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

import { formatMinutes, parseTime, stepMinutes } from '@/lib/time';
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

/* ------------------------------------------------------------------ time -- */

/**
 * A clock time, as minutes from midnight.
 *
 * Typed rather than picked: the platform pickers are not in Expo Go, and a
 * four-digit time is faster to type than it is to spin to anyway. The arrows
 * are there for the common case of nudging a meal half an hour either way.
 *
 * The field keeps its own draft string while it is being typed, because
 * "1" and "13:" are not times and must not be pushed upstream as one.
 */
export function TimeField({
  label,
  minutes,
  onChange,
  hint }: {
  label: string;
  minutes: number;
  onChange: (minutes: number) => void;
  hint?: string;
}) {
  const t = useTokens();
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    const parsed = parseTime(text);
    if (parsed !== null) onChange(parsed);
    setDraft(null);
  };

  return (
    <View style={{ gap: space.sm }}>
      <Eyebrow>{label}</Eyebrow>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Stepper icon="remove" onPress={() => onChange(stepMinutes(minutes, -30))} label={`${label} earlier`} />
        <View
          style={{
            flex: 1,
            backgroundColor: t.surface,
            borderColor: t.line,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderRadius: radius.md }}>
          <TextInput
            value={draft ?? formatMinutes(minutes)}
            onChangeText={setDraft}
            onBlur={() => commit(draft ?? '')}
            onSubmitEditing={() => commit(draft ?? '')}
            keyboardType="numbers-and-punctuation"
            selectTextOnFocus
            placeholderTextColor={t.inkFaint}
            style={{
              paddingVertical: 12,
              textAlign: 'center',
              fontFamily: type_.figure.fontFamily,
              fontSize: 19,
              color: t.ink }}
          />
        </View>
        <Stepper icon="add" onPress={() => onChange(stepMinutes(minutes, 30))} label={`${label} later`} />
      </View>
      {hint ? <Text style={[type_.small, { color: t.inkFaint, fontSize: 12.5 }]}>{hint}</Text> : null}
    </View>
  );
}

function Stepper({ icon, onPress, label }: { icon: IconName; onPress: () => void; label: string }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.accentWash : t.surface,
        borderColor: t.line,
        borderWidth: StyleSheet.hairlineWidth * 2 })}>
      <Ionicons name={icon} size={19} color={t.accentText} />
    </Pressable>
  );
}

/* ---------------------------------------------------------------- toggle -- */

/**
 * A labelled on/off row. Drawn rather than using RN's Switch so it carries the
 * app's own palette in both themes -- the platform switch ignores tokens and
 * reads as borrowed furniture next to everything else here.
 */
export function Toggle({
  label,
  hint,
  value,
  onChange }: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
      <View
        style={{
          width: 44,
          height: 26,
          borderRadius: radius.pill,
          padding: 3,
          justifyContent: 'center',
          alignItems: value ? 'flex-end' : 'flex-start',
          backgroundColor: value ? t.accent : t.surfaceAlt,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: value ? t.accent : t.line }}>
        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: value ? t.surface : t.inkFaint }} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type_.body, { color: t.ink, fontFamily: type_.meta.fontFamily, fontSize: 14.5 }]}>{label}</Text>
        {hint ? <Text style={[type_.small, { color: t.inkFaint, fontSize: 12.5, lineHeight: 17 }]}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}
