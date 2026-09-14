import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chips, EmptyState, ErrorNote, Eyebrow, Loading, Segmented } from '@/components/ui/kit';
import {
  applyLibraryFilters,
  applyTemplate,
  EMPTY_LIBRARY_FILTERS,
  loadLibrary,
  loadTemplates,
  type LibraryFilters } from '@/lib/library';
import { errorMessage } from '@/lib/supabase';
import { CUISINES, MEAL_CATEGORIES, type LibraryRecipe, type PlanTemplate } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

type Tab = 'recipes' | 'plans';

export default function LibraryScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();

  const [tab, setTab] = useState<Tab>('recipes');
  const [recipes, setRecipes] = useState<LibraryRecipe[]>([]);
  const [templates, setTemplates] = useState<PlanTemplate[]>([]);
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_LIBRARY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!household) return;
    try {
      const [r, tpl] = await Promise.all([loadLibrary(household.id), loadTemplates(household.id)]);
      setRecipes(r);
      setTemplates(tpl);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [household]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const shown = useMemo(() => applyLibraryFilters(recipes, filters), [recipes, filters]);
  const activeFilters =
    filters.categories.length +
    filters.cuisines.length +
    (filters.favouritesOnly ? 1 : 0) +
    (filters.cookedOnly ? 1 : 0) +
    (filters.minRating != null ? 1 : 0);

  if (loading) return <Loading />;

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, gap: space.md }}>
        <Text style={{ fontSize: 26, fontFamily: fonts.bold, letterSpacing: -0.5, color: t.ink }}>Library</Text>
        <Segmented
          options={[
            { value: 'recipes', label: `Recipes · ${recipes.length}` },
            { value: 'plans', label: `Saved plans · ${templates.length}` },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'recipes' ? (
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextInput
              value={filters.query}
              onChangeText={(query) => setFilters((f) => ({ ...f, query }))}
              placeholder="Search recipes"
              placeholderTextColor={t.inkFaint}
              autoCorrect={false}
              clearButtonMode="while-editing"
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
              accessibilityLabel="Filters"
              onPress={() => setShowFilters((v) => !v)}
              style={{
                paddingHorizontal: space.lg,
                justifyContent: 'center',
                borderRadius: radius.md,
                borderWidth: StyleSheet.hairlineWidth * 2,
                borderColor: activeFilters ? t.accent : t.line,
                backgroundColor: activeFilters ? t.accentWash : t.surface }}>
              <Text style={{ color: activeFilters ? t.accentText : t.inkMuted, fontFamily: fonts.semibold, fontSize: 14 }}>
                Filter{activeFilters ? ` · ${activeFilters}` : ''}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.md }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
            tintColor={t.inkFaint}
          />
        }>
        <ErrorNote message={error} />

        {tab === 'recipes' && showFilters ? (
          <View
            style={{
              backgroundColor: t.surface,
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: t.line,
              padding: space.lg,
              gap: space.lg }}>
            <Chips
              label="Show only"
              options={['Favourites', 'Cooked before', 'Rated 4+']}
              values={[
                filters.favouritesOnly ? 'Favourites' : '',
                filters.cookedOnly ? 'Cooked before' : '',
                filters.minRating === 4 ? 'Rated 4+' : '',
              ].filter(Boolean)}
              onChange={(values) =>
                setFilters((f) => ({
                  ...f,
                  favouritesOnly: values.includes('Favourites'),
                  cookedOnly: values.includes('Cooked before'),
                  minRating: values.includes('Rated 4+') ? 4 : null }))
              }
            />
            <Chips
              label="Meal"
              options={[...MEAL_CATEGORIES]}
              values={filters.categories}
              onChange={(categories) => setFilters((f) => ({ ...f, categories }))}
            />
            <Chips
              label="Cuisine"
              options={CUISINES}
              values={filters.cuisines}
              onChange={(cuisines) => setFilters((f) => ({ ...f, cuisines }))}
            />
            <Button
              label="Clear filters"
              variant="secondary"
              onPress={() => setFilters((f) => ({ ...EMPTY_LIBRARY_FILTERS, query: f.query }))}
            />
          </View>
        ) : null}

        {tab === 'recipes' ? (
          shown.length === 0 ? (
            <EmptyState
              title={recipes.length ? 'Nothing matches' : 'No recipes yet'}
              body={
                recipes.length
                  ? 'Nothing fits the current search and filters.'
                  : 'Plan and cook a meal and it is kept here, with what you thought of it, ready to use again.'
              }
            />
          ) : (
            shown.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} onPress={() => router.push(`/recipe/${recipe.id}`)} />
            ))
          )
        ) : templates.length === 0 ? (
          <EmptyState
            title="No saved plans"
            body="Save a day or a week you liked and it can be applied to a future date — re-checked against your pantry as it is then."
          />
        ) : (
          templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onApply={async () => {
                try {
                  const plan = await applyTemplate(template.id, new Date().toISOString().slice(0, 10));
                  router.push(`/plan/${plan.id}`);
                } catch (e) {
                  Alert.alert('Could not apply that plan', errorMessage(e));
                }
              }}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function RecipeCard({ recipe, onPress }: { recipe: LibraryRecipe; onPress: () => void }) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.surfaceAlt : t.surface,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: t.line,
        padding: space.lg,
        gap: 5 })}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <Text style={{ flex: 1, fontSize: 16, fontFamily: fonts.bold, color: t.ink, letterSpacing: -0.2 }}>
          {recipe.name}
        </Text>
        {recipe.favourite ? (
          <Text style={{ fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.5, color: t.accentText, textTransform: 'uppercase' }}>
            Favourite
          </Text>
        ) : null}
      </View>
      <Text style={{ fontSize: 12.5, color: t.inkFaint }}>
        {[
          recipe.category,
          recipe.cuisine,
          recipe.est_minutes ? `${recipe.est_minutes} min` : null,
          recipe.total_calories ? `${recipe.total_calories} kcal` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <Text style={{ fontSize: 12.5, color: recipe.times_cooked ? t.accentText : t.inkFaint }}>
        {recipe.times_cooked
          ? `Cooked ${recipe.times_cooked}×${recipe.avg_rating ? ` · rated ${recipe.avg_rating}` : ''}`
          : 'Not cooked yet'}
      </Text>
    </Pressable>
  );
}

function TemplateCard({ template, onApply }: { template: PlanTemplate; onApply: () => void }) {
  const t = useTokens();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: t.line,
        padding: space.lg,
        gap: space.md }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 16, fontFamily: fonts.bold, color: t.ink }}>{template.name}</Text>
        <Text style={{ fontSize: 12.5, color: t.inkFaint }}>
          {template.shape.length} meal{template.shape.length === 1 ? '' : 's'} · {template.scope}
          {template.times_used ? ` · used ${template.times_used}×` : ''}
        </Text>
      </View>
      <Button label="Use this plan" variant="secondary" onPress={onApply} />
      <Text style={{ fontSize: 11.5, color: t.inkFaint, lineHeight: 16 }}>
        Applied as a draft and re-checked against your pantry — same rhythm, whatever is missing goes to the shopping
        list.
      </Text>
    </View>
  );
}
