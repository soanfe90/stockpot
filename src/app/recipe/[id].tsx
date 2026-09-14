import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorNote, Eyebrow, Loading } from '@/components/ui/kit';
import { adaptRecipe, quickSlots, scheduleFromLibrary, toggleFavourite } from '@/lib/library';
import { loadRecipe } from '@/lib/planning';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Recipe, RecipeIngredient, RecipeStats } from '@/lib/types';
import { formatQty } from '@/lib/units';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function RecipeScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [recipe, setRecipe] = useState<(Recipe & { favourite?: boolean }) | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [stats, setStats] = useState<RecipeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [{ recipe: r, ingredients: ing }, statsRes] = await Promise.all([
        loadRecipe(id),
        supabase.from('recipe_stats').select('*').eq('recipe_id', id).maybeSingle(),
      ]);
      setRecipe(r);
      setIngredients(ing);
      setStats((statsRes.data as RecipeStats) ?? null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function schedule() {
    if (!id) return;
    const slots = quickSlots();
    Alert.alert('When do you want to cook this?', 'It goes on as a draft — approving is what reserves the ingredients.', [
      ...slots.map((slot) => ({
        text: slot.label,
        onPress: async () => {
          try {
            const plan = await scheduleFromLibrary(id, slot.when, recipe?.servings);
            router.push(`/plan/${plan.id}`);
          } catch (e) {
            setError(errorMessage(e));
          }
        } })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function adapt() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await adaptRecipe(id, recipe?.servings);
      Alert.alert(
        'Adapted to your pantry',
        result.changes.length ? result.changes.map((c) => `· ${c}`).join('\n') : 'Nothing needed changing.',
        [
          { text: 'Keep the original', style: 'cancel' },
          { text: 'Open the new version', onPress: () => router.replace(`/recipe/${result.recipe_id}`) },
        ]
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (!recipe) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground, padding: space.lg }}>
        <ErrorNote message={error ?? 'That recipe no longer exists.'} />
      </View>
    );
  }

  const favourite = recipe.favourite ?? false;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.ground }}
      contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <Text style={{ fontSize: 26, fontFamily: fonts.bold, letterSpacing: -0.5, color: t.ink }}>{recipe.name}</Text>
        <Text style={{ fontSize: 13, color: t.inkFaint }}>
          {[
            recipe.category,
            recipe.cuisine,
            recipe.est_minutes ? `${recipe.est_minutes} min` : null,
            recipe.total_calories ? `${recipe.total_calories} kcal` : null,
            `serves ${recipe.servings}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {recipe.diet_types.length ? (
          <Text style={{ fontSize: 12.5, color: t.accentText }}>{recipe.diet_types.join(' · ')}</Text>
        ) : null}
        {recipe.parent_recipe_id ? (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/recipe/${recipe.parent_recipe_id}`)}>
            <Text style={{ fontSize: 12.5, color: t.accentText, fontFamily: fonts.semibold }}>
              Adapted from an earlier version →
            </Text>
          </Pressable>
        ) : null}
      </View>

      <ErrorNote message={error} />

      {stats && stats.times_cooked > 0 ? (
        <Card>
          <Text style={{ fontSize: 14, color: t.inkMuted, lineHeight: 21 }}>
            Cooked {stats.times_cooked} time{stats.times_cooked === 1 ? '' : 's'} here
            {stats.avg_rating ? `, rated ${stats.avg_rating} on average` : ''}
            {stats.last_cooked
              ? `. Last made ${new Date(stats.last_cooked).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.`
              : '.'}
          </Text>
        </Card>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Eyebrow>Ingredients</Eyebrow>
        <View style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line, overflow: 'hidden' }}>
          {ingredients.map((ing, index) => (
            <View
              key={ing.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                gap: space.md,
                padding: space.lg,
                backgroundColor: t.surface,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: t.line }}>
              <Text style={{ fontSize: 14.5, color: t.ink, flex: 1 }}>
                {ing.name}
                {ing.optional ? <Text style={{ color: t.inkFaint }}> · optional</Text> : null}
              </Text>
              <Text style={{ fontSize: 14, color: t.inkMuted, fontVariant: ['tabular-nums'] }}>
                {formatQty(ing.qty, ing.base_unit, ing.display_unit)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={{ gap: space.md }}>
        <Eyebrow>Method</Eyebrow>
        {recipe.steps.map((step, index) => (
          <View key={index} style={{ flexDirection: 'row', gap: space.md }}>
            <Text style={{ fontSize: 12, fontFamily: fonts.bold, color: t.accentText, minWidth: 20, paddingTop: 3, fontVariant: ['tabular-nums'] }}>
              {index + 1}
            </Text>
            <Text style={{ flex: 1, fontSize: 15, lineHeight: 23, color: t.ink }}>{step}</Text>
          </View>
        ))}
      </View>

      {recipe.tips.length ? (
        <Card>
          <View style={{ gap: space.sm }}>
            <Eyebrow>Tips</Eyebrow>
            {recipe.tips.map((tip, index) => (
              <Text key={index} style={{ fontSize: 14, lineHeight: 21, color: t.inkMuted }}>
                {tip}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}

      <View style={{ gap: space.sm }}>
        <Button label="Cook this again" onPress={schedule} />
        <Button label="Refit it to what I have now" variant="secondary" onPress={adapt} busy={busy} />
        <Button
          label={favourite ? 'Remove from favourites' : 'Add to favourites'}
          variant="ghost"
          onPress={async () => {
            try {
              await toggleFavourite(recipe.id, !favourite);
              setRecipe({ ...recipe, favourite: !favourite });
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        />
      </View>

      <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
        Refitting never changes this recipe. It creates a new version linked back to this one, so the library keeps
        what you actually cooked.
      </Text>
    </ScrollView>
  );
}
