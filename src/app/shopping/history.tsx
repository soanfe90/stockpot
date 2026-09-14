import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorNote, Loading } from '@/components/ui/kit';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Purchase } from '@/lib/types';
import { formatQty } from '@/lib/units';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function PurchaseHistoryScreen() {
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();

  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!household) return;
    supabase
      .from('purchase')
      .select('*')
      .eq('household_id', household.id)
      .order('closed_at', { ascending: false })
      .limit(50)
      .then(({ data, error: loadError }) => {
        if (loadError) setError(errorMessage(loadError));
        else setPurchases((data ?? []) as Purchase[]);
        setLoading(false);
      });
  }, [household]);

  if (loading) return <Loading />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.ground }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}>
      <ErrorNote message={error} />

      {purchases.length === 0 ? (
        <EmptyState
          title="No trips yet"
          body="Finish a shopping trip and it is archived here — what you bought, what it cost, and when."
        />
      ) : (
        purchases.map((purchase) => (
          <View
            key={purchase.id}
            style={{
              backgroundColor: t.surface,
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: t.line,
              padding: space.lg,
              gap: space.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{ fontSize: 15.5, fontFamily: fonts.bold, color: t.ink }}>
                {purchase.store || 'Shopping trip'}
              </Text>
              {purchase.total != null ? (
                <Text style={{ fontSize: 15, fontFamily: fonts.bold, color: t.ink, fontVariant: ['tabular-nums'] }}>
                  {purchase.total.toFixed(2)}
                </Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 12, color: t.inkFaint }}>
              {new Date(purchase.closed_at).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric' })}
              {' · '}
              {purchase.items.length} item{purchase.items.length === 1 ? '' : 's'}
            </Text>
            <View style={{ gap: 2, marginTop: 4 }}>
              {purchase.items.map((line, index) => (
                <View key={`${purchase.id}-${index}`} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: t.inkMuted, flex: 1 }}>
                    {line.name}
                  </Text>
                  <Text style={{ fontSize: 13, color: t.inkFaint, fontVariant: ['tabular-nums'] }}>
                    {formatQty(line.qty, baseOf(line.display_unit), line.display_unit)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

/** Snapshots keep only the display unit; its base is derivable from it. */
function baseOf(displayUnit: string): 'g' | 'ml' | 'unit' {
  const key = displayUnit.toLowerCase();
  if (key === 'g' || key === 'kg') return 'g';
  if (key === 'ml' || key === 'l') return 'ml';
  return 'unit';
}
