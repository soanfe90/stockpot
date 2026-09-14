import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/text';

import { CATEGORIES } from '@/lib/categories';
import { SOON_DAYS, URGENT_DAYS } from '@/lib/expiry';
import type { Filters, StateFilter, StockSummary } from '@/hooks/use-inventory';
import { Button, Eyebrow } from '@/components/ui/kit';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'expiring', label: `Expiring (${SOON_DAYS}d)` },
  { value: 'expired', label: 'Expired' },
];

/* --------------------------------------------------------------- search -- */

export function SearchBar({
  value,
  onChange,
  onOpenFilters,
  activeFilterCount }: {
  value: string;
  onChange: (value: string) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
}) {
  const t = useTokens();
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search products"
        placeholderTextColor={t.inkFaint}
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search products"
        style={{
          flex: 1,
          backgroundColor: t.surface,
          borderColor: t.line,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderRadius: radius.md,
          paddingHorizontal: space.md,
          paddingVertical: 11,
          fontSize: 15,
          color: t.ink }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Filters${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}
        onPress={onOpenFilters}
        style={{
          paddingHorizontal: space.lg,
          justifyContent: 'center',
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: activeFilterCount ? t.accent : t.line,
          backgroundColor: activeFilterCount ? t.accentWash : t.surface }}>
        <Text style={{ color: activeFilterCount ? t.accentText : t.inkMuted, fontFamily: fonts.semibold, fontSize: 14 }}>
          Filter{activeFilterCount ? ` · ${activeFilterCount}` : ''}
        </Text>
      </Pressable>
    </View>
  );
}

/** Active filters stay visible as removable chips, so nobody wonders why
 *  their pantry looks empty. */
export function ActiveFilterChips({
  filters,
  onRemoveCategory,
  onRemoveState,
  onClear }: {
  filters: Filters;
  onRemoveCategory: (category: string) => void;
  onRemoveState: (state: StateFilter) => void;
  onClear: () => void;
}) {
  const t = useTokens();
  const count = filters.categories.length + filters.states.length;
  if (!count) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md }}>
      {filters.categories.map((category) => (
        <Chip key={`c-${category}`} label={category} onPress={() => onRemoveCategory(category)} />
      ))}
      {filters.states.map((state) => (
        <Chip
          key={`s-${state}`}
          label={STATE_OPTIONS.find((o) => o.value === state)?.label ?? state}
          onPress={() => onRemoveState(state)}
        />
      ))}
      <Pressable accessibilityRole="button" onPress={onClear} style={{ justifyContent: 'center', paddingHorizontal: space.sm }}>
        <Text style={{ color: t.accentText, fontSize: 13, fontFamily: fonts.semibold }}>Clear all</Text>
      </Pressable>
    </ScrollView>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove filter ${label}`}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: t.accentWash,
        borderRadius: radius.sm,
        paddingVertical: 6,
        paddingHorizontal: space.md }}>
      <Text style={{ color: t.accentText, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: t.accentText, fontSize: 14, fontFamily: fonts.bold }}>×</Text>
    </Pressable>
  );
}

/* --------------------------------------------------------- filter sheet -- */

export function FilterSheet({
  visible,
  filters,
  onChange,
  onClose,
  onCollapseAll,
  onExpandAll }: {
  visible: boolean;
  filters: Filters;
  onChange: (filters: Filters) => void;
  onClose: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}) {
  const t = useTokens();

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter inventory">
      <View style={{ gap: space.xl }}>
        <View style={{ gap: space.md }}>
          <Eyebrow>Groups</Eyebrow>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Collapse all" variant="secondary" onPress={onCollapseAll} style={{ flex: 1 }} />
            <Button label="Expand all" variant="secondary" onPress={onExpandAll} style={{ flex: 1 }} />
          </View>
        </View>

        <View style={{ gap: space.md }}>
          <Eyebrow>Stock state</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {STATE_OPTIONS.map((option) => (
              <Toggle
                key={option.value}
                label={option.label}
                active={filters.states.includes(option.value)}
                onPress={() => onChange({ ...filters, states: toggle(filters.states, option.value) })}
              />
            ))}
          </View>
          <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
            Expiring covers anything within {SOON_DAYS} days; the first {URGENT_DAYS} are flagged in orange.
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          <Eyebrow>Category</Eyebrow>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {CATEGORIES.map((category) => (
              <Toggle
                key={category}
                label={category}
                active={filters.categories.includes(category)}
                onPress={() => onChange({ ...filters, categories: toggle(filters.categories, category) })}
              />
            ))}
          </View>
        </View>

        <Button label="Show results" onPress={onClose} />
      </View>
    </Sheet>
  );
}

function Toggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={{
        paddingVertical: 9,
        paddingHorizontal: space.md,
        borderRadius: radius.sm,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: active ? t.accent : t.line,
        backgroundColor: active ? t.accentWash : t.surface }}>
      <Text style={{ fontSize: 13.5, color: active ? t.accentText : t.inkMuted, fontFamily: active ? fonts.semibold : fonts.body }}>
        {label}
      </Text>
    </Pressable>
  );
}

/* -------------------------------------------------------- summary sheet -- */

/** Every count is a filter you can act on. A number nobody can tap is a
 *  worse version of a filter. */
export function SummarySheet({
  visible,
  summary,
  onClose,
  onSelect }: {
  visible: boolean;
  summary: StockSummary;
  onClose: () => void;
  onSelect: (state: StateFilter | null) => void;
}) {
  const t = useTokens();

  const rows: { label: string; value: number; filter: StateFilter | null; color: string }[] = [
    { label: 'Products tracked', value: summary.total, filter: null, color: t.ink },
    { label: 'In stock', value: summary.inStock, filter: 'in_stock', color: t.fresh },
    { label: `Expiring within ${URGENT_DAYS} days`, value: summary.expiringUrgent, filter: 'expiring', color: t.urgent },
    { label: `Expiring within ${SOON_DAYS} days`, value: summary.expiringSoon, filter: 'expiring', color: t.soon },
    { label: 'Expired', value: summary.expired, filter: 'expired', color: t.gone },
    { label: 'Out of stock', value: summary.outOfStock, filter: 'out_of_stock', color: t.gone },
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title="Stock summary">
      <View style={{ borderColor: t.line, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.md }}>
        {rows.map((row, index) => (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            onPress={() => {
              onSelect(row.filter);
              onClose();
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingVertical: 14,
              paddingHorizontal: space.lg,
              backgroundColor: pressed ? t.surfaceAlt : t.surface,
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderColor: t.line })}>
            <Text style={{ fontSize: 14.5, color: t.inkMuted }}>{row.label}</Text>
            <Text style={{ fontSize: 17, fontFamily: fonts.bold, color: row.color, fontVariant: ['tabular-nums'] }}>
              {row.value}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17, marginTop: space.md }}>
        Tap any line to filter the list by it.
      </Text>
    </Sheet>
  );
}

/* ---------------------------------------------------------- sheet shell -- */

function Sheet({
  visible,
  onClose,
  title,
  children }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const t = useTokens();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: '#0006' }} />
      <View
        style={{
          backgroundColor: t.ground,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
          maxHeight: '82%' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: space.lg,
            paddingBottom: space.lg }}>
          <Text style={{ fontSize: 18, fontFamily: fonts.bold, color: t.ink, letterSpacing: -0.3 }}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <Text style={{ fontSize: 15, color: t.accentText, fontFamily: fonts.semibold }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------ add sheet -- */

/** The two ways stock gets in. Scanning leads because it is the reason the
 *  app exists; typing stays one tap away for the odd single item. */
export function AddSheet({
  visible,
  onClose,
  onScan,
  onManual }: {
  visible: boolean;
  onClose: () => void;
  onScan: () => void;
  onManual: () => void;
}) {
  const t = useTokens();
  return (
    <Sheet visible={visible} onClose={onClose} title="Add products">
      <View style={{ gap: space.md }}>
        <Choice
          title="Scan a receipt or your groceries"
          body="Photograph the till roll, or the shopping on the counter. Everything lands in a list you check before it is added."
          onPress={onScan}
          primary
        />
        <Choice
          title="Add one by hand"
          body="Name, quantity, and a shelf life. Best for a single item, or something with no packaging."
          onPress={onManual}
        />
      </View>
      <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17, marginTop: space.md }}>
        Corrections you make to a scan are remembered against the product, so the same shop reads more accurately
        every time.
      </Text>
    </Sheet>
  );
}

function Choice({
  title,
  body,
  onPress,
  primary }: {
  title: string;
  body: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        padding: space.lg,
        gap: 5,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: primary ? t.accent : t.line,
        backgroundColor: pressed ? t.surfaceAlt : primary ? t.accentWash : t.surface })}>
      <Text style={{ fontSize: 15.5, fontFamily: fonts.bold, color: primary ? t.accentText : t.ink }}>{title}</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, color: t.inkMuted }}>{body}</Text>
    </Pressable>
  );
}
