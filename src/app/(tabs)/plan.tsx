import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorNote, Eyebrow, Loading } from '@/components/ui/kit';
import { loadSchedule, mealLabel, skipMeal } from '@/lib/planning';
import { errorMessage } from '@/lib/supabase';
import type { ScheduledMeal } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function PlanScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();

  const [meals, setMeals] = useState<ScheduledMeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!household) return;
    try {
      setMeals(await loadSchedule(household.id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [household]);

  // Coming back from cooking should show the next meal, not the one just made.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (loading) return <Loading />;

  const [next, ...rest] = meals;

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 96 }}
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
        <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, gap: space.sm }}>
          <Text style={{ fontSize: 26, fontFamily: fonts.bold, letterSpacing: -0.5, color: t.ink }}>Meals</Text>
          <Text style={{ fontSize: 12, color: t.inkFaint }}>
            {meals.length ? `${meals.length} still to cook` : 'Nothing scheduled'}
          </Text>
        </View>

        {error ? (
          <View style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
            <ErrorNote message={error} />
          </View>
        ) : null}

        {!meals.length ? (
          <EmptyState
            title="No meals planned"
            body="Stockpot builds a plan from what is actually in your pantry, starting with whatever is closest to turning."
            action={<Button label="Plan some meals" onPress={() => router.push('/plan/create')} />}
          />
        ) : (
          <View style={{ padding: space.lg, gap: space.xl }}>
            <View style={{ gap: space.sm }}>
              <Eyebrow color={t.accentText}>Next up</Eyebrow>
              <NextMealCard
                meal={next}
                onCook={() => router.push(`/cook/${next.id}`)}
                onSkip={async () => {
                  await skipMeal(next.id);
                  await load();
                }}
              />
            </View>

            {rest.length ? (
              <View style={{ gap: space.sm }}>
                <Eyebrow>Later</Eyebrow>
                <View style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line, overflow: 'hidden' }}>
                  {rest.map((meal, index) => (
                    <Pressable
                      key={meal.id}
                      accessibilityRole="button"
                      onPress={() => router.push(`/cook/${meal.id}`)}
                      style={({ pressed }) => ({
                        padding: space.lg,
                        gap: 3,
                        backgroundColor: pressed ? t.surfaceAlt : t.surface,
                        borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                        borderTopColor: t.line })}>
                      <Text style={{ fontSize: 11, color: t.inkFaint, fontFamily: fonts.semibold }}>
                        {mealLabel(meal.scheduled_at)} · {meal.category}
                      </Text>
                      <Text style={{ fontSize: 15.5, fontFamily: fonts.semibold, color: t.ink }}>{meal.recipe.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {meals.length ? (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: space.lg,
            paddingTop: space.md,
            paddingBottom: space.md,
            backgroundColor: t.ground,
            borderTopWidth: StyleSheet.hairlineWidth * 2,
            borderTopColor: t.line }}>
          <Button label="Plan more meals" variant="secondary" onPress={() => router.push('/plan/create')} />
        </View>
      ) : null}
    </View>
  );
}

function NextMealCard({
  meal,
  onCook,
  onSkip }: {
  meal: ScheduledMeal;
  onCook: () => void;
  onSkip: () => void;
}) {
  const t = useTokens();
  return (
    <View
      style={{
        backgroundColor: t.surface,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: t.accent,
        padding: space.lg,
        gap: space.md }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.8, textTransform: 'uppercase', color: t.accentText }}>
          {mealLabel(meal.scheduled_at)} · {meal.category}
        </Text>
        <Text style={{ fontSize: 21, fontFamily: fonts.bold, letterSpacing: -0.3, color: t.ink }}>{meal.recipe.name}</Text>
        <Text style={{ fontSize: 12.5, color: t.inkFaint }}>
          {[
            meal.recipe.cuisine,
            meal.recipe.est_minutes ? `${meal.recipe.est_minutes} min` : null,
            meal.recipe.total_calories ? `${meal.recipe.total_calories} kcal` : null,
            `serves ${meal.servings}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button label="Cook" onPress={onCook} style={{ flex: 1 }} />
        <Button label="Skip" variant="secondary" onPress={onSkip} />
      </View>
    </View>
  );
}
