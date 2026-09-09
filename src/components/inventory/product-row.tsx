import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDate, stateColors, stateLabel, stockState, type StockState } from '@/lib/expiry';
import type { StockedProduct } from '@/lib/types';
import { formatQty } from '@/lib/units';
import { radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export function StatePill({ state, expiry }: { state: StockState; expiry: string | null }) {
  const t = useTokens();
  const { fg, bg } = stateColors(t, state);
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 3 }}>
      <Text style={{ color: fg, fontSize: 10.5, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {stateLabel(state, expiry)}
      </Text>
    </View>
  );
}

export function ProductRow({ product, onPress }: { product: StockedProduct; onPress: () => void }) {
  const t = useTokens();
  const state = stockState(product.qty_total, product.next_expiry);
  const { fg } = stateColors(t, state);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatQty(product.qty_total, product.base_unit, product.display_unit)}, ${stateLabel(state, product.next_expiry)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: 13,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? t.surfaceAlt : t.surface,
      })}>
      {/* A severity stripe puts the state in the row's form, not just its text. */}
      <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: fg }} />

      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ fontSize: 15.5, fontWeight: '600', color: t.ink }}>
          {product.name}
        </Text>
        <Text style={{ fontSize: 12.5, color: t.inkFaint }}>
          {product.next_expiry ? formatDate(product.next_expiry) : 'No date'}
          {product.lot_count > 1 ? ` · ${product.lot_count} lots` : ''}
          {product.qty_reserved > 0
            ? ` · ${formatQty(product.qty_reserved, product.base_unit, product.display_unit)} reserved`
            : ''}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '600',
            color: t.ink,
            fontVariant: ['tabular-nums'],
          }}>
          {formatQty(product.qty_total, product.base_unit, product.display_unit)}
        </Text>
        <StatePill state={state} expiry={product.next_expiry} />
      </View>
    </Pressable>
  );
}

export function CategoryHeader({
  category,
  count,
  collapsed,
  onToggle,
}: {
  category: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: !collapsed }}
      onPress={onToggle}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: space.sm,
        paddingHorizontal: space.lg,
        backgroundColor: t.ground,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: t.line,
      }}>
      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase', color: t.inkFaint }}>
        {category}
      </Text>
      <Text style={{ fontSize: 11, color: t.inkFaint, fontVariant: ['tabular-nums'] }}>
        {collapsed ? `${count} hidden` : count}
      </Text>
    </Pressable>
  );
}
