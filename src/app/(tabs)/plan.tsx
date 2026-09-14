import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorNote, Eyebrow, FloatingBar, Icon, Loading, useFloatingBar } from '@/components/ui/kit';
import { cancelPlan, loadSchedule, mealLabel, skipMeal } from '@/lib/planning';
import { errorMessage } from '@/lib/supabase';
import type { ScheduledMeal } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function PlanScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Measured rather than guessed: a fixed clearance hides the bottom of the
  // list the moment the bar's contents change.
  const bar = useFloatingBar();
  const { household } = useHousehold();

  const [meals, setMeals] = useState<ScheduledMeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Clearing the schedule out entirely. Cancelling is what does the real work:
   * it hands every reservation back, takes this plan's rows off the shopping
   * list, and clears out the products that were invented for meals nobody will
   * now cook.
   */
  function deletePlan() {
    if (!household || !meals.length) return;
    const planId = meals[0].plan_id;
    const spread = new Set(meals.map((m) => m.plan_id)).size;

    Alert.alert(
      spread > 1 ? 'Delete the current plan?' : 'Delete this plan?',
      'Every meal in it goes, its ingredients are released back into your pantry, and anything it put on your ' +
        'shopping list that you have not already ticked comes off. Nothing is deducted from your stock.' +
        (spread > 1 ? '\n\nOnly the plan the next meal belongs to is deleted.' : ''),
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await cancelPlan(planId, household.id);
              await load();
            } catch (e) {
              setError(errorMessage(e));
            }
          } },
      ]
    );
  }

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
        contentContainerStyle={{ paddingBottom: bar.clearance }}
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
          {/* Without this the plan is only reachable in the moments after it is
              generated, which is where saving it to the library lives. */}
          {meals.length ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/plan/${meals[0].plan_id}`)}
              hitSlop={6}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: space.xs }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: t.accentText }}>
                Open the whole plan
              </Text>
              <Icon name="chevron-forward" size={14} color={t.accentText} />
            </Pressable>
          ) : null}
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
                onAdjust={() => router.push(`/meal/${next.id}`)}
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
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                        <Text style={{ flex: 1, fontSize: 11, color: t.inkFaint, fontFamily: fonts.semibold }}>
                          {mealLabel(meal.scheduled_at)} · {meal.category}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Adjust ${meal.recipe.name}`}
                          onPress={() => router.push(`/meal/${meal.id}`)}
                          hitSlop={10}>
                          <Icon name="options-outline" size={17} color={t.accentText} />
                        </Pressable>
                      </View>
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
        <FloatingBar {...bar.props}>
          <Button label="Plan more meals" variant="secondary" onPress={() => router.push('/plan/create')} />
          <Button label="Delete this plan" variant="ghost" onPress={deletePlan} />
        </FloatingBar>
      ) : null}
    </View>
  );
}

function NextMealCard({
  meal,
  onCook,
  onAdjust,
  onSkip }: {
  meal: ScheduledMeal;
  onCook: () => void;
  onAdjust: () => void;
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
        <Button label="Adjust" variant="secondary" onPress={onAdjust} />
        <Button label="Skip" variant="ghost" onPress={onSkip} />
      </View>
    </View>
  );
}
