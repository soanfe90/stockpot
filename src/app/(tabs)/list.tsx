import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorNote, FloatingBar, Loading, useFloatingBar } from '@/components/ui/kit';
import { useShoppingList } from '@/hooks/use-shopping-list';
import { daysUntil, formatDate } from '@/lib/expiry';
import { SOURCE_LABELS, type ItemSource, type ShoppingItem } from '@/lib/types';
import { formatQty, parseQty } from '@/lib/units';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function ShoppingScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();
  // Measured rather than guessed: the bar's height is whatever its buttons
  // come to, and a fixed clearance hides the bottom of the list the moment
  // that changes.
  const bar = useFloatingBar();
  const { sections, items, checked, remaining, loading, error, refresh, patch, remove, addManual } =
    useShoppingList(household?.id ?? null);

  const [draft, setDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  async function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    // "2 leche" and "leche" both work; a leading number is taken as a count.
    const match = text.match(/^(\d+(?:[.,]\d+)?)\s+(.*)$/);
    const qty = match ? (parseQty(match[1]) ?? 1) : 1;
    const name = match ? match[2] : text;
    setDraft('');
    await addManual(name, qty, 'ud', 'unit');
  }

  if (loading) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, gap: space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, fontFamily: fonts.bold, letterSpacing: -0.5, color: t.ink }}>Shopping</Text>
            <Text style={{ fontSize: 12, color: t.inkFaint, marginTop: 2 }}>
              {remaining} to get{checked.length ? ` · ${checked.length} in the basket` : ''}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.push('/shopping/history')} hitSlop={10}>
            <Text style={{ color: t.accentText, fontSize: 13, fontFamily: fonts.semibold }}>Past trips</Text>
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submitDraft}
            placeholder="Add something — e.g. 2 limones"
            placeholderTextColor={t.inkFaint}
            returnKeyType="done"
            accessibilityLabel="Add an item to the list"
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
          <Button label="Add" variant="secondary" onPress={submitDraft} />
        </View>
      </View>

      {error ? (
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          <ErrorNote message={error} />
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        style={{ marginTop: space.md }}
        contentContainerStyle={{ paddingBottom: bar.clearance }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkFaint} />}
        renderSectionHeader={({ section }) => (
          <Text
            style={{
              fontSize: 11,
              fontFamily: fonts.bold,
              letterSpacing: 1.1,
              textTransform: 'uppercase',
              color: t.inkFaint,
              backgroundColor: t.ground,
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderColor: t.line }}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <ItemRow item={item} onToggle={() => patch(item, { checked: !item.checked })} onRemove={() => remove(item)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />}
        ListEmptyComponent={
          <EmptyState
            title="Nothing to buy"
            body="The list fills itself from your pantry — what ran out, what is running low, and what is about to turn. Add anything else above."
          />
        }
      />

      {items.length ? (
        <FloatingBar {...bar.props}>
          <Button
            label={checked.length ? `Finish purchase · ${checked.length}` : 'Tick what you bought'}
            disabled={!checked.length}
            onPress={() => router.push('/shopping/review')}
          />
        </FloatingBar>
      ) : null}
    </View>
  );
}

/** Coloured by how close it is: a date the eye slides over is not a deadline,
 *  and this one decides whether a trip to the shop happens at all. */
function Deadline({ on }: { on: string }) {
  const t = useTokens();
  const days = daysUntil(on);
  const pressing = days !== null && days <= 2;
  return (
    <Text
      style={{
        fontSize: 11.5,
        color: pressing ? t.urgent : t.inkFaint,
        fontFamily: pressing ? fonts.semibold : undefined }}>
      · by {formatDate(on)}
    </Text>
  );
}

function ItemRow({
  item,
  onToggle,
  onRemove }: {
  item: ShoppingItem;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const t = useTokens();
  const reason = sourceStyle(t, item.source);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.checked }}
      accessibilityLabel={`${item.name}, ${SOURCE_LABELS[item.source]}`}
      onPress={onToggle}
      onLongPress={onRemove}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: 13,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? t.surfaceAlt : t.surface,
        opacity: item.checked ? 0.55 : 1 })}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.sm,
          borderWidth: 2,
          borderColor: item.checked ? t.accent : t.lineStrong,
          backgroundColor: item.checked ? t.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center' }}>
        {item.checked ? <Text style={{ color: t.ground, fontSize: 13, fontFamily: fonts.bold }}>✓</Text> : null}
      </View>

      <View style={{ flex: 1, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 15.5,
            fontFamily: fonts.semibold,
            color: t.ink,
            textDecorationLine: item.checked ? 'line-through' : 'none' }}>
          {item.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 10.5, fontFamily: fonts.bold, letterSpacing: 0.4, textTransform: 'uppercase', color: reason }}>
            {SOURCE_LABELS[item.source]}
          </Text>
          {item.needed_by ? <Deadline on={item.needed_by} /> : null}
        </View>
      </View>

      <Text style={{ fontSize: 14, fontFamily: fonts.semibold, color: t.inkMuted, fontVariant: ['tabular-nums'] }}>
        {formatQty(item.qty, item.base_unit, item.display_unit)}
      </Text>
    </Pressable>
  );
}

/** These reasons are stock states, so they use the freshness ramp with the
 *  same meaning it carries in the inventory. Manual and recipe rows are not
 *  stock states and stay neutral. */
function sourceStyle(t: ReturnType<typeof useTokens>, source: ItemSource): string {
  switch (source) {
    case 'out_of_stock':
      return t.gone;
    case 'expiring':
      return t.urgent;
    case 'low':
      return t.soon;
    default:
      return t.inkFaint;
  }
}
