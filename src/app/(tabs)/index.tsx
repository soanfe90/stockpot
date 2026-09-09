import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ActiveFilterChips,
  AddSheet,
  FilterSheet,
  SearchBar,
  SummarySheet,
} from '@/components/inventory/controls';
import { CategoryHeader, ProductRow } from '@/components/inventory/product-row';
import { Button, EmptyState, ErrorNote, Loading } from '@/components/ui/kit';
import {
  applyFilters,
  EMPTY_FILTERS,
  useInventory,
  useStockSummary,
  type Filters,
  type StateFilter,
} from '@/hooks/use-inventory';
import { categoryRank } from '@/lib/categories';
import type { StockedProduct } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function InventoryScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();

  const { products, aliases, loading, error, refresh } = useInventory(household?.id ?? null);
  const summary = useStockSummary(products);

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => applyFilters(products, aliases, filters), [products, aliases, filters]);

  const sections = useMemo(() => {
    const groups = new Map<string, StockedProduct[]>();
    for (const product of visible) {
      const list = groups.get(product.category) ?? [];
      list.push(product);
      groups.set(product.category, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
      .map(([title, data]) => ({
        title,
        count: data.length,
        data: collapsed.includes(title) ? [] : data,
      }));
  }, [visible, collapsed]);

  const activeFilterCount = filters.categories.length + filters.states.length;

  async function onRefresh() {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }

  if (loading && !products.length) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={{ paddingTop: insets.top + space.md }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            paddingHorizontal: space.lg,
            paddingBottom: space.md,
          }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 26, fontWeight: '700', letterSpacing: -0.5, color: t.ink }} numberOfLines={1}>
              {household?.name ?? 'Inventory'}
            </Text>
            <Text style={{ fontSize: 12, color: t.inkFaint, marginTop: 2 }}>
              {summary.total} products · invite code {household?.invite_code}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Preferences"
            onPress={() => router.push('/preferences')}
            hitSlop={10}>
            <Text style={{ color: t.accentText, fontSize: 13, fontWeight: '600' }}>Preferences</Text>
          </Pressable>
        </View>

        <SearchBar
          value={filters.query}
          onChange={(query) => setFilters((f) => ({ ...f, query }))}
          onOpenFilters={() => setShowFilters(true)}
          activeFilterCount={activeFilterCount}
        />

        <ActiveFilterChips
          filters={filters}
          onRemoveCategory={(category) =>
            setFilters((f) => ({ ...f, categories: f.categories.filter((c) => c !== category) }))
          }
          onRemoveState={(state) => setFilters((f) => ({ ...f, states: f.states.filter((s) => s !== state) }))}
          onClear={() => setFilters((f) => ({ ...EMPTY_FILTERS, query: f.query }))}
        />
      </View>

      {error ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <ErrorNote message={error} />
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.inkFaint} />}
        renderSectionHeader={({ section }) => (
          <CategoryHeader
            category={section.title}
            count={section.count}
            collapsed={collapsed.includes(section.title)}
            onToggle={() =>
              setCollapsed((prev) =>
                prev.includes(section.title) ? prev.filter((c) => c !== section.title) : [...prev, section.title]
              )
            }
          />
        )}
        renderItem={({ item }) => (
          <ProductRow product={item} onPress={() => router.push(`/product/${item.id}`)} />
        )}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />}
        ListEmptyComponent={
          products.length === 0 ? (
            <EmptyState
              title="Nothing in the pantry yet"
              body="Photograph a receipt and Stockpot fills the pantry in one go, then starts tracking what is about to turn."
              action={<Button label="Scan a receipt" onPress={() => router.push('/capture/camera')} />}
            />
          ) : (
            <EmptyState
              title="No products match"
              body="Nothing here fits the current search and filters. Clear them to see the whole pantry again."
              action={<Button label="Clear filters" variant="secondary" onPress={() => setFilters(EMPTY_FILTERS)} />}
            />
          )
        }
      />

      {/* Summary on the left, capture on the right -- the two things you do
          from this screen, always in the same place. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: 'row',
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.md,
          backgroundColor: t.ground,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: t.line,
        }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stock summary"
          onPress={() => setShowSummary(true)}
          style={{
            width: 48,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: t.lineStrong,
            backgroundColor: t.surface,
          }}>
          <Text style={{ color: t.inkMuted, fontSize: 17, fontWeight: '700' }}>i</Text>
        </Pressable>
        <Button label="Add products" onPress={() => setShowAdd(true)} style={{ flex: 1 }} />
      </View>

      <FilterSheet
        visible={showFilters}
        filters={filters}
        onChange={setFilters}
        onClose={() => setShowFilters(false)}
        onCollapseAll={() => setCollapsed(sections.map((s) => s.title))}
        onExpandAll={() => setCollapsed([])}
      />

      <AddSheet
        visible={showAdd}
        onClose={() => setShowAdd(false)}
        onScan={() => {
          setShowAdd(false);
          router.push('/capture/camera');
        }}
        onManual={() => {
          setShowAdd(false);
          router.push('/product/new');
        }}
      />

      <SummarySheet
        visible={showSummary}
        summary={summary}
        onClose={() => setShowSummary(false)}
        onSelect={(state: StateFilter | null) =>
          setFilters((f) => ({ ...f, states: state ? [state] : [] }))
        }
      />
    </View>
  );
}
