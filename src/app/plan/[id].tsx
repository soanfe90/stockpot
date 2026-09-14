import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorNote, Eyebrow, Icon, Loading } from '@/components/ui/kit';
import { savePlanAsTemplate } from '@/lib/library';
import { remindersAvailable, scheduleReminders } from '@/lib/notifications';
import {
  addPlanGaps,
  approvePlan,
  cancelPlan,
  generatePlan,
  loadPlan,
  loadSchedule,
  mealLabel,
} from '@/lib/planning';
import { errorMessage } from '@/lib/supabase';
import { DEFAULT_MEAL_TIMES, type MealPlan, type PlanShortfall, type ScheduledMeal } from '@/lib/types';
import { formatQty } from '@/lib/units';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function ReviewPlanScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household, profile } = useHousehold();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [meals, setMeals] = useState<ScheduledMeal[]>([]);
  const [shortfalls, setShortfalls] = useState<PlanShortfall[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await loadPlan(id);
      setPlan(data.plan);
      setMeals(data.meals);
      setShortfalls(data.shortfalls);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve() {
    if (!id || !household) return;
    setBusy(true);
    setError(null);
    try {
      await approvePlan(id);
      const gaps = shortfalls.length ? await addPlanGaps(id) : 0;

      // By this point the plan is approved and its ingredients are reserved.
      // Reminders are a convenience on top, so a failure here must not be
      // reported as a failed approval -- that leaves the user staring at an
      // error for something that actually succeeded, and tapping approve again
      // only tells them it is already approved.
      const reminders = await scheduleReminders(await loadSchedule(household.id)).catch(() => 0);
      Alert.alert(
        'Plan approved',
        [
          `${meals.length} meal${meals.length === 1 ? '' : 's'} scheduled`,
          'Their ingredients are now reserved in your pantry.',
          gaps ? `${gaps} missing item${gaps === 1 ? '' : 's'} added to your shopping list.` : null,
          reminders
            ? `${reminders} reminder${reminders === 1 ? '' : 's'} set for 30 minutes before.`
            : remindersAvailable()
              ? null
              : 'Reminders need a development build — they do not work in Expo Go.',
        ]
          .filter(Boolean)
          .join('\n'),
        [{ text: 'Done', onPress: () => router.replace('/plan') }]
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /** Saving a plan is how the library gets reusable weeks. The default name
   *  is the date, because naming things is a chore nobody wants mid-flow. */
  function saveAsTemplate() {
    if (!id || !plan) return;
    const defaultName = `${plan.scope === 'week' ? 'Week of' : 'Plan for'} ${new Date(
      `${plan.starts_on}T00:00:00`
    ).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;

    Alert.alert('Save this plan?', `It will appear in your library as "${defaultName}", ready to apply to a future date.`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Save',
        onPress: async () => {
          try {
            await savePlanAsTemplate(id, defaultName);
            Alert.alert('Saved', 'You can apply it to any future date from the library.');
          } catch (e) {
            setError(errorMessage(e));
          }
        } },
    ]);
  }

  /**
   * Starting over: the old plan is cancelled and a fresh one generated over
   * the same days. Cancelling first is what gives the reservations back, so
   * the new plan is built against the full pantry rather than against what
   * the plan it replaces had already spoken for.
   */
  function startOver() {
    if (!id || !plan || !household) return;
    Alert.alert(
      'Start this plan over?',
      approved
        ? 'These meals are dropped and their ingredients released, then a new plan is built over the same days.'
        : 'These meals are dropped and a new plan is built over the same days. Nothing has been taken from your pantry.',
      [
        { text: 'Keep this one', style: 'cancel' },
        {
          text: 'Start over',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError(null);
            try {
              await cancelPlan(id);
              const result = await generatePlan(
                household.id,
                plan.scope,
                plan.starts_on,
                {
                  diets: profile?.diet_types ?? [],
                  cuisines: profile?.cuisines ?? [],
                  goals: profile?.goals ?? [],
                  servings: meals[0]?.servings ?? 2 },
                profile?.meal_times ?? DEFAULT_MEAL_TIMES
              );
              router.replace(`/plan/${result.plan_id}`);
            } catch (e) {
              // The old plan is already gone by this point, so say so rather
              // than leaving them on a screen whose meals no longer exist.
              setError(`${errorMessage(e)} The previous plan was already cleared — try generating a new one.`);
              setBusy(false);
            }
          } },
      ]
    );
  }

  function discard() {
    if (!id) return;
    Alert.alert('Discard this plan?', 'The meals are deleted. Nothing has been taken from your pantry.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelPlan(id);
            router.replace('/plan');
          } catch (e) {
            setError(errorMessage(e));
          }
        } },
    ]);
  }

  if (loading) return <Loading />;
  if (!plan) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground, padding: space.lg }}>
        <ErrorNote message={error ?? 'That plan no longer exists.'} />
      </View>
    );
  }

  const approved = plan.status !== 'draft';
  const byDay = groupByDay(meals);

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 120, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Eyebrow>{approved ? 'Approved plan' : 'Review before approving'}</Eyebrow>
          <Text style={{ fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.4, color: t.ink }}>
            {meals.length} meal{meals.length === 1 ? '' : 's'}
          </Text>
          <Text style={{ fontSize: 13, color: t.inkMuted, lineHeight: 19 }}>
            Every ingredient below is already in your pantry. Nothing is reserved until you approve.
            {approved ? '' : ' Tap any meal to change its time, its ingredients, or swap it for another.'}
          </Text>
        </View>

        <ErrorNote message={error} />

        {shortfalls.length ? (
          <Card>
            <View style={{ gap: space.md }}>
              <Eyebrow color={t.soon}>Short by</Eyebrow>
              {shortfalls.map((s) => (
                <View key={s.product_id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 14, color: t.ink }}>{s.product_name}</Text>
                  <Text style={{ fontSize: 14, color: t.soon, fontVariant: ['tabular-nums'] }}>
                    {formatQty(s.shortfall, s.base_unit, s.display_unit)}
                  </Text>
                </View>
              ))}
              <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
                Approving adds these to your shopping list, marked as needed for a meal.
              </Text>
            </View>
          </Card>
        ) : null}

        {byDay.map(([day, dayMeals]) => (
          <View key={day} style={{ gap: space.sm }}>
            <Eyebrow>{day}</Eyebrow>
            <View style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line, overflow: 'hidden' }}>
              {dayMeals.map((meal, index) => (
                <Pressable
                  key={meal.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${meal.recipe.name}`}
                  onPress={() => router.push(`/meal/${meal.id}`)}
                  style={({ pressed }) => ({
                    padding: space.lg,
                    gap: 4,
                    backgroundColor: pressed ? t.accentWash : t.surface,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: t.line })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: 10.5,
                        fontFamily: fonts.bold,
                        letterSpacing: 0.8,
                        textTransform: 'uppercase',
                        color: t.accentText }}>
                      {meal.category} · {mealLabel(meal.scheduled_at).split(' ').slice(-1)[0]}
                    </Text>
                    <Icon name="chevron-forward" size={15} color={t.inkFaint} />
                  </View>
                  <Text style={{ fontSize: 16, fontFamily: fonts.semibold, color: t.ink }}>{meal.recipe.name}</Text>
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
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: insets.bottom + space.md,
          backgroundColor: t.ground,
          borderTopWidth: StyleSheet.hairlineWidth * 2,
          borderTopColor: t.line }}>
        {approved ? (
          <>
            <Button label="Save to library as a reusable plan" variant="secondary" onPress={saveAsTemplate} />
            <Button label="Start this plan over" variant="ghost" onPress={startOver} busy={busy} />
          </>
        ) : (
          <>
            <Button label="Approve and reserve ingredients" onPress={approve} busy={busy} />
            <Button label="Start this plan over" variant="secondary" onPress={startOver} busy={busy} />
            <Button label="Save to library as a reusable plan" variant="ghost" onPress={saveAsTemplate} />
            <Button label="Discard" variant="ghost" onPress={discard} />
          </>
        )}
      </View>
    </View>
  );
}

function groupByDay(meals: ScheduledMeal[]): [string, ScheduledMeal[]][] {
  const groups = new Map<string, ScheduledMeal[]>();
  for (const meal of meals) {
    const key = new Date(meal.scheduled_at).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short' });
    groups.set(key, [...(groups.get(key) ?? []), meal]);
  }
  return [...groups.entries()];
}
