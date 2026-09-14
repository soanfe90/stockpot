import { useNavigation, useRouter } from 'expo-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Chips, ErrorNote, Field, Segmented, Title } from '@/components/ui/kit';
import { Working } from '@/components/ui/working';
import { generatePlan } from '@/lib/planning';
import { errorMessage } from '@/lib/supabase';
import {
  CUISINES,
  DEFAULT_MEAL_TIMES,
  DEFAULT_SHOPPING_DAYS,
  DIET_TYPES,
  GOALS,
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
  const abort = useRef<AbortController | null>(null);
  const navigation = useNavigation();

  // The cover blocks the screen, but the header sits above it in the native
  // stack -- so the way out has to be taken off the header too, or the lock is
  // only as good as where the user happens to tap.
  useLayoutEffect(() => {
    navigation.setOptions({ headerBackVisible: !busy, headerLeft: busy ? () => null : undefined });
  }, [navigation, busy]);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!household) return;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await generatePlan(
        household.id,
        scope,
        new Date().toISOString().slice(0, 10),
        {
          diets,
          cuisines,
          goals,
          servings: Math.max(1, Number.parseInt(servings, 10) || 2) },
        // Sent with the request rather than read server-side, so a plan lands
        // at the times this member actually eats at, on this device's clock.
        profile?.meal_times ?? DEFAULT_MEAL_TIMES,
        // A week plan is built around the days this member can actually shop;
        // the review screen can rebuild it on different ones before approving.
        profile?.shopping_days ?? DEFAULT_SHOPPING_DAYS,
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
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
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
