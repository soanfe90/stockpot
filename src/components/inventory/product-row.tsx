import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';

import { categoryIcon } from '@/lib/categories';
import { formatDate, stateColors, stateLabel, stockState, type StockState } from '@/lib/expiry';
import type { StockedProduct } from '@/lib/types';
import { formatQty } from '@/lib/units';
import { radius, space, type as type_ } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export function StatePill({ state, expiry }: { state: StockState; expiry: string | null }) {
  const t = useTokens();
  const { fg, bg } = stateColors(t, state);
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 }}>
      <Text style={[type_.label, { color: fg, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' }]}>
        {stateLabel(state, expiry)}
      </Text>
    </View>
  );
}

/**
 * A product has no photograph, so its category glyph stands in -- tinted by
 * stock state, which means the icon says what it is and the colour says how
 * urgent it is, in one mark.
 */
export function ProductAvatar({ category, state, size = 42 }: { category: string; state: StockState; size?: number }) {
  const t = useTokens();
  const { fg, bg } = stateColors(t, state);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center' }}>
      <Ionicons name={categoryIcon(category) as IoniconName} size={size * 0.46} color={fg} />
    </View>
  );
}

export function ProductRow({ product, onPress }: { product: StockedProduct; onPress: () => void }) {
  const t = useTokens();
  const state = stockState(product.qty_total, product.next_expiry);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatQty(product.qty_total, product.base_unit, product.display_unit)}, ${stateLabel(state, product.next_expiry)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: 12,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? t.surfaceAlt : t.surface })}>
      <ProductAvatar category={product.category} state={state} />

      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={[type_.item, { color: t.ink }]}>
          {product.name}
        </Text>
        <Text style={[type_.meta, { color: t.inkFaint }]} numberOfLines={1}>
          {product.next_expiry ? formatDate(product.next_expiry) : 'No date'}
          {product.lot_count > 1 ? ` · ${product.lot_count} lots` : ''}
          {product.qty_reserved > 0
            ? ` · ${formatQty(product.qty_reserved, product.base_unit, product.display_unit)} reserved`
            : ''}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        <Text style={[type_.figure, { color: t.ink }]}>
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
  onToggle }: {
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
        gap: space.sm,
        paddingVertical: 10,
        paddingHorizontal: space.lg,
        backgroundColor: t.ground }}>
      <Ionicons name={categoryIcon(category) as IoniconName} size={14} color={t.inkFaint} />
      <Text style={[type_.label, { textTransform: 'uppercase', color: t.inkFaint, flex: 1 }]}>{category}</Text>
      <Text style={[type_.meta, { color: t.inkFaint }]}>{collapsed ? `${count} hidden` : count}</Text>
      <Ionicons name={collapsed ? 'chevron-down' : 'chevron-up'} size={14} color={t.inkFaint} />
    </Pressable>
  );
}
