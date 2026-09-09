import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorNote, Eyebrow, Loading } from '@/components/ui/kit';
import { scheduleReminders } from '@/lib/notifications';
import { addPlanGaps, approvePlan, cancelPlan, loadPlan, loadSchedule, mealLabel } from '@/lib/planning';
import { errorMessage } from '@/lib/supabase';
import type { MealPlan, PlanShortfall, ScheduledMeal } from '@/lib/types';
import { formatQty } from '@/lib/units';
import { useHousehold } from '@/providers/household-provider';
import { radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function ReviewPlanScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household } = useHousehold();
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
      const reminders = await scheduleReminders(await loadSchedule(household.id));
      Alert.alert(
        'Plan approved',
        [
          `${meals.length} meal${meals.length === 1 ? '' : 's'} scheduled`,
          'Their ingredients are now reserved in your pantry.',
          gaps ? `${gaps} missing item${gaps === 1 ? '' : 's'} added to your shopping list.` : null,
          reminders ? `${reminders} reminder${reminders === 1 ? '' : 's'} set for 30 minutes before.` : null,
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
        },
      },
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
          <Text style={{ fontSize: 24, fontWeight: '700', letterSpacing: -0.4, color: t.ink }}>
            {meals.length} meal{meals.length === 1 ? '' : 's'}
          </Text>
          <Text style={{ fontSize: 13, color: t.inkMuted, lineHeight: 19 }}>
            Every ingredient below is already in your pantry. Nothing is reserved until you approve.
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
                <View
                  key={meal.id}
                  style={{
                    padding: space.lg,
                    gap: 4,
                    backgroundColor: t.surface,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: t.line,
                  }}>
                  <Text style={{ fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: t.accentText }}>
                    {meal.category} · {mealLabel(meal.scheduled_at).split(' ').slice(-1)[0]}
                  </Text>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: t.ink }}>{meal.recipe.name}</Text>
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
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {!approved ? (
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
            borderTopColor: t.line,
          }}>
          <Button label="Approve and reserve ingredients" onPress={approve} busy={busy} />
          <Button label="Discard" variant="ghost" onPress={discard} />
        </View>
      ) : null}
    </View>
  );
}

function groupByDay(meals: ScheduledMeal[]): [string, ScheduledMeal[]][] {
  const groups = new Map<string, ScheduledMeal[]>();
  for (const meal of meals) {
    const key = new Date(meal.scheduled_at).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
    groups.set(key, [...(groups.get(key) ?? []), meal]);
  }
  return [...groups.entries()];
}
