import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorNote, Eyebrow, Field, Loading } from '@/components/ui/kit';
import { useShoppingList } from '@/hooks/use-shopping-list';
import { errorMessage } from '@/lib/supabase';
import type { ShoppingItem } from '@/lib/types';
import { fromBase, parseQty, toBase } from '@/lib/units';
import { useHousehold } from '@/providers/household-provider';
import { fonts, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function ReviewPurchaseScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();
  const { checked, loading, patch, close } = useShoppingList(household?.id ?? null);

  const [store, setStore] = useState('');
  const [total, setTotal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const parsedTotal = total.trim() ? parseQty(total) : null;
      const result = await close(store.trim() || null, parsedTotal);
      Alert.alert(
        'Inventory updated',
        [
          `${result.items_added} item${result.items_added === 1 ? '' : 's'} added to the pantry`,
          result.products_created
            ? `${result.products_created} new product${result.products_created === 1 ? '' : 's'}`
            : null,
          result.rolled_over
            ? `${result.rolled_over} item${result.rolled_over === 1 ? '' : 's'} kept for next time`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
        [{ text: 'Done', onPress: () => router.replace('/list') }]
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Eyebrow>Before this reaches the pantry</Eyebrow>
          <Text style={{ fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.4, color: t.ink }}>
            {checked.length} item{checked.length === 1 ? '' : 's'} bought
          </Text>
          <Text style={{ fontSize: 13, color: t.inkMuted, lineHeight: 19 }}>
            Adjust anything you bought a different amount of. Whatever you left unticked stays on the list for next
            time.
          </Text>
        </View>

        <ErrorNote message={error} />

        <View style={{ borderRadius: 6, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line, overflow: 'hidden' }}>
          {checked.map((item, index) => (
            <PurchasedRow
              key={item.id}
              item={item}
              first={index === 0}
              onChange={(qty) => patch(item, { purchased_qty: qty })}
            />
          ))}
        </View>

        <Card>
          <View style={{ gap: space.lg }}>
            <Field label="Store" value={store} onChangeText={setStore} placeholder="Mercadona" autoCapitalize="words" />
            <Field
              label="Total spent"
              value={total}
              onChangeText={setTotal}
              keyboardType="decimal-pad"
              placeholder="0.00"
              hint="Optional. Recorded with the trip so you can see spend over time."
            />
          </View>
        </Card>

        <Button
          label={`Add ${checked.length} to inventory`}
          onPress={submit}
          busy={busy}
          disabled={!checked.length}
        />
        <Button label="Back to the list" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PurchasedRow({
  item,
  first,
  onChange }: {
  item: ShoppingItem;
  first: boolean;
  onChange: (qty: number) => void;
}) {
  const t = useTokens();
  const shown = item.purchased_qty ?? item.qty;
  const [text, setText] = useState(String(fromBase(shown, item.base_unit, item.display_unit)));

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        backgroundColor: t.surface,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: t.line }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontFamily: fonts.semibold, color: t.ink }}>{item.name}</Text>
        <Text style={{ fontSize: 12, color: t.inkFaint, marginTop: 2 }}>{item.category}</Text>
      </View>
      <View style={{ width: 120 }}>
        <Field
          label=""
          value={text}
          onChangeText={(next) => {
            setText(next);
            const parsed = parseQty(next);
            if (parsed !== null) onChange(toBase(parsed, item.base_unit, item.display_unit));
          }}
          keyboardType="decimal-pad"
          suffix={item.display_unit}
        />
      </View>
    </View>
  );
}
