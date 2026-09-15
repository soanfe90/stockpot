import { useNavigation, useRouter } from 'expo-router';

import { backOr } from '@/lib/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Chips, ErrorNote, Field, Segmented, Title } from '@/components/ui/kit';
import { Working } from '@/components/ui/working';
import { generatePlan, mealsLeftToday, nextFreeDay, planShape, today } from '@/lib/planning';
import { formatDate } from '@/lib/expiry';
import { errorMessage } from '@/lib/supabase';
import {
  CUISINES,
  DEFAULT_MEAL_TIMES,
  DEFAULT_PLANNED_MEALS,
  DEFAULT_SHOPPING_DAYS,
  DIET_TYPES,
  GOALS,
  MEAL_SLOTS,
  type PlanScope,
} from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

export default function CreatePlanScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household, profile } = useHousehold();

  const [scope, setScope] = useState<PlanScope>('day');
  // Seeded from the saved profile; changes here apply to this plan only.
  const [diets, setDiets] = useState<string[]>(profile?.diet_types ?? []);
  const [cuisines, setCuisines] = useState<string[]>(profile?.cuisines ?? []);
  const [goals, setGoals] = useState<string[]>(profile?.goals ?? []);
  const [servings, setServings] = useState(String(household?.size ?? 2));
  const [busy, setBusy] = useState(false);
  // What the app worked out, and what the user actually wants. They differ
  // whenever something is already scheduled, and the app should not be the one
  // deciding which is right: somebody who just cleared their week means now.
  const [nextFree, setNextFree] = useState<string | null>(null);
  const [startsOn, setStartsOn] = useState<string | null>(null);
  // Which meal of the first day to begin at. Null means "whatever has not
  // happened yet", which is right almost always.
  const [firstMeal, setFirstMeal] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const navigation = useNavigation();

  const meals = profile?.planned_meals ?? DEFAULT_PLANNED_MEALS;
  const mealTimes = profile?.meal_times ?? DEFAULT_MEAL_TIMES;

  // Starting today, only what is still ahead can be chosen. Starting later,
  // the whole day is available -- somebody may be out until the evening on the
  // day their plan begins.
  const startsToday = startsOn === today();
  const available = startsToday ? mealsLeftToday(meals, mealTimes) : meals;

  // Today is only on offer while some of it is left. Offering a day the plan
  // cannot start on is worse than not offering it.
  const dayOptions = [
    ...(mealsLeftToday(meals, mealTimes).length ? [{ value: today(), label: 'Today' }] : []),
    ...(nextFree && nextFree !== today() ? [{ value: nextFree, label: formatDate(nextFree) }] : []),
    ...(nextFree === today() && !mealsLeftToday(meals, mealTimes).length
      ? [{ value: tomorrow(), label: formatDate(tomorrow()) }]
      : []),
  ];

  const shape =
    startsOn === null
      ? []
      : planShape({
          days: scope === 'week' ? 7 : 1,
          meals,
          mealTimes,
          startsToday,
          firstMeal: firstMeal ?? (startsToday ? null : available[0] ?? null),
        });

  const firstDay = shape.filter((slot) => slot.day_offset === 0);
  const shapeNote = !startsOn
    ? null
    : shape.length === 0
      ? 'Every meal you plan has already passed today. Start on another day, or add meals in Settings.'
      : `${shape.length} meal${shape.length === 1 ? '' : 's'}: ${listOf(
          firstDay.map((slot) => MEAL_SLOTS.find((m) => m.value === slot.category)?.label.toLowerCase() ?? slot.category)
        )}${startsToday ? ' today' : ' on the first day'}${
          scope === 'week' ? `, then the same each day to ${formatDate(addDays(startsOn, 6))}` : ''
        }.`;

  // The cover blocks the screen, but the header sits above it in the native
  // stack -- so the way out has to be taken off the header too, or the lock is
  // only as good as where the user happens to tap.
  useLayoutEffect(() => {
    navigation.setOptions({ headerBackVisible: !busy, headerLeft: busy ? () => null : undefined });
  }, [navigation, busy]);

  // Shown before generating, so it is never a surprise where the plan landed.
  useEffect(() => {
    if (!household) return;
    void nextFreeDay(household.id).then((day) => {
      setNextFree(day);
      // Defaulting to the free day keeps a new plan from competing with one
      // that already exists; the choice below is what makes it a default
      // rather than a decision taken on the user's behalf.
      //
      // Except when that day is today and today is over: a plan cannot start
      // at a meal that has already happened, so it starts tomorrow. Leaving it
      // on today was how this screen came to show no starting-meal choice at
      // all -- the control had nothing to offer, so it silently disappeared.
      const nothingLeft = mealsLeftToday(meals, mealTimes).length === 0;
      setStartsOn(day === today() && nothingLeft ? tomorrow() : day);
    });
  }, [household, meals, mealTimes]);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!household) return;
    const controller = new AbortController();
    abort.current = controller;

    // The very shape the screen has been describing. Recomputing it here would
    // let the preview and the request drift apart, which is the one thing a
    // preview must never do.
    const from = startsOn ?? (await nextFreeDay(household.id));
    if (shape.length === 0) {
      setError('Every meal you plan has already passed today. Start on another day, or add meals in Settings.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await generatePlan(
        household.id,
        scope,
        from,
        {
          diets,
          cuisines,
          goals,
          servings: Math.max(1, Number.parseInt(servings, 10) || 2) },
        // Sent with the request rather than read server-side, so a plan lands
        // at the times this member actually eats at, on this device's clock.
        mealTimes,
        // A week plan is built around the days this member can actually shop;
        // the review screen can rebuild it on different ones before approving.
        profile?.shopping_days ?? DEFAULT_SHOPPING_DAYS,
        profile?.llm_model ?? null,
        shape,
        controller.signal
      );
      router.replace(`/plan/${result.plan_id}`);
    } catch (e) {
      // A cancel is not a failure, and reporting it as one would be the app
      // telling the user off for pressing the button it offered them.
      if (!controller.signal.aborted) setError(errorMessage(e));
      setBusy(false);
    } finally {
      abort.current = null;
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.md }}>
          <Title>Plan some meals</Title>
          <Body>
            Every suggestion comes from what is actually in your pantry, working through whatever is closest to
            expiring first.
          </Body>
          {startsOn && dayOptions.length > 1 ? (
            <View style={{ gap: space.sm, paddingTop: space.xs }}>
              <Segmented
                label="Starting"
                options={dayOptions}
                value={startsOn}
                onChange={(day) => {
                  setStartsOn(day);
                  // A meal chosen for one day may not exist on the other -- a
                  // lunch picked for tomorrow is already gone if the plan moves
                  // to today -- so the choice is made again rather than carried.
                  setFirstMeal(null);
                }}
              />
              <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
                {startsOn === today()
                  ? 'You already have meals scheduled in these days. Both plans will draw on the same pantry, so approve them one at a time.'
                  : 'After the meals you already have scheduled, so the two plans do not compete for the same food.'}
              </Text>
            </View>
          ) : startsOn ? (
            <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
              {startsToday ? 'Starting today.' : `Starting ${formatDate(startsOn)}.`}
            </Text>
          ) : null}

          {/* Offered whenever there is more than one meal to choose between,
              on any start day. It used to appear only when the plan started
              today AND two meals were still ahead -- which meant that with any
              plan already scheduled, where the start date defaults to the next
              free day, it never appeared at all. */}
          {startsOn && available.length ? (
            <View style={{ gap: space.sm, paddingTop: space.xs }}>
              <Segmented
                label="Beginning at"
                options={available.map((m) => ({
                  value: m,
                  label: MEAL_SLOTS.find((s) => s.value === m)?.label ?? m,
                }))}
                value={firstMeal ?? available[0]}
                onChange={setFirstMeal}
              />
            </View>
          ) : null}

          {/* What you are about to get, said plainly. The shape is decided by
              three things at once -- the meals you plan, the day, and the clock
              -- so it should never have to be inferred from the controls. */}
          {shapeNote ? (
            <Text style={{ fontSize: 12.5, color: t.inkMuted, lineHeight: 18, paddingTop: space.xs }}>
              {shapeNote}
            </Text>
          ) : null}
        </View>

        <Segmented
          label="How much to plan"
          options={[
            { value: 'single', label: 'One meal' },
            { value: 'day', label: 'A day' },
            { value: 'week', label: 'A week' },
          ]}
          value={scope}
          onChange={setScope}
        />

        <Card>
          <View style={{ gap: space.xl }}>
            <Chips
              label="Diet"
              options={DIET_TYPES}
              values={diets}
              onChange={setDiets}
              hint="A hard filter. Nothing outside these will be suggested, even to use something up."
            />
            <Chips
              label="Cuisines"
              options={CUISINES}
              values={cuisines}
              onChange={setCuisines}
              hint="A preference, not a filter — a sparse pantry beats a themed one."
            />
            <Chips label="What you want from this plan" options={GOALS} values={goals} onChange={setGoals} />
          </View>
        </Card>

        <Field
          label="Servings per meal"
          value={servings}
          onChangeText={setServings}
          keyboardType="number-pad"
          suffix="people"
          hint="Changes here apply to this plan only. Your household preferences stay as they are."
        />

        <ErrorNote message={error} />

        <View style={{ gap: space.sm }}>
          <Button label="Generate plan" onPress={generate} busy={busy} />
          <Button label="Cancel" variant="ghost" onPress={() => backOr(router, '/plan')} />
        </View>

        <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
          Nothing is reserved until you approve the plan. You can regenerate as many times as you like first.
        </Text>
      </ScrollView>

      {busy ? (
        <Working
          title="Building your plan"
          steps={[
            'Reading your pantry, soonest to expire first…',
            'Choosing meals that fit what is actually there…',
            'Checking every ingredient against real quantities…',
            'Writing the plan and scheduling the meals…',
          ]}
          note="Cancelling stops the wait. If the plan lands anyway it will be waiting under Meals, unapproved, with nothing reserved."
          onCancel={() => abort.current?.abort()}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** "lunch and dinner", "breakfast, lunch and dinner". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function tomorrow(): string {
  return addDays(today(), 1);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
