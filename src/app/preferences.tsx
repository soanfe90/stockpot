import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Alert } from 'react-native';

import { Body, Button, Card, Chips, Eyebrow, ErrorNote, Segmented, TimeField, Title } from '@/components/ui/kit';
import { errorMessage } from '@/lib/supabase';
import { CUISINES, DEFAULT_MEAL_TIMES, DIET_TYPES, GOALS, type MealTimes } from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { useSession } from '@/providers/session-provider';
import { space } from '@/theme/tokens';
import { useThemeMode, useTokens } from '@/theme/use-tokens';
import type { ThemeMode } from '@/theme/theme-provider';

/**
 * Asked once at signup and editable forever after. These three answers steer
 * every future suggestion, which is why the goals below map to concrete
 * changes in how plans are built rather than sitting in a profile unread.
 */
export default function PreferencesScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, savePreferences } = useHousehold();
  const { signOut } = useSession();
  const { mode, setMode } = useThemeMode();

  const first = !profile?.onboarded_at;
  const [diets, setDiets] = useState<string[]>(profile?.diet_types ?? []);
  const [cuisines, setCuisines] = useState<string[]>(profile?.cuisines ?? []);
  const [goals, setGoals] = useState<string[]>(profile?.goals ?? []);
  const [mealTimes, setMealTimes] = useState<MealTimes>(profile?.meal_times ?? DEFAULT_MEAL_TIMES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePreferences({ diets, cuisines, goals, mealTimes });
      if (first) router.replace('/');
      else router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.ground }}
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: first ? insets.top + space.xxl : space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.xl }}
      keyboardShouldPersistTaps="handled">
      <View style={{ gap: space.md }}>
        <Title>{first ? 'How do you eat?' : 'Your preferences'}</Title>
        <Body>
          These steer every meal Stockpot suggests. You can change them any time, and adjust them for a single plan
          without touching what is saved here.
        </Body>
      </View>

      <Card>
        <View style={{ gap: space.md }}>
          <Eyebrow>Appearance</Eyebrow>
          <Segmented
            options={[
              { value: 'light', label: 'Light', icon: 'sunny-outline' },
              { value: 'dark', label: 'Dark', icon: 'moon-outline' },
              { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
            ]}
            value={mode}
            onChange={(next: ThemeMode) => setMode(next)}
          />
          <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
            Applies straight away and stays on this device. System follows whatever your phone is set to.
          </Text>
        </View>
      </Card>

      <Card>
        <View style={{ gap: space.lg }}>
          <View style={{ gap: space.xs }}>
            <Eyebrow>When you eat</Eyebrow>
            <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
              Every generated meal lands at one of these, and reminders come 30 minutes before. Type a time or nudge it
              half an hour.
            </Text>
          </View>
          <TimeField
            label="Breakfast"
            minutes={mealTimes.breakfast}
            onChange={(m) => setMealTimes((prev) => ({ ...prev, breakfast: m }))}
          />
          <TimeField
            label="Lunch"
            minutes={mealTimes.lunch}
            onChange={(m) => setMealTimes((prev) => ({ ...prev, lunch: m }))}
          />
          <TimeField
            label="Dinner"
            minutes={mealTimes.dinner}
            onChange={(m) => setMealTimes((prev) => ({ ...prev, dinner: m }))}
          />
          <TimeField
            label="Snack"
            minutes={mealTimes.snack}
            onChange={(m) => setMealTimes((prev) => ({ ...prev, snack: m }))}
            hint="Only used when a plan suggests one."
          />
        </View>
      </Card>

      <Card>
        <View style={{ gap: space.xl }}>
          <Chips
            label="Diet"
            options={DIET_TYPES}
            values={diets}
            onChange={setDiets}
            hint="A hard filter. Nothing outside these is ever suggested, even to use something up."
          />
          <Chips
            label="Cuisines you like"
            options={CUISINES}
            values={cuisines}
            onChange={setCuisines}
            hint="A preference, not a filter — a sparse pantry beats a themed one."
          />
          <Chips
            label="What you want from your meals"
            options={GOALS}
            values={goals}
            onChange={setGoals}
            hint="Each of these changes how plans are built, not just what they are called."
          />
        </View>
      </Card>

      <ErrorNote message={error} />

      <View style={{ gap: space.sm }}>
        <Button label={first ? 'Save and start' : 'Save'} onPress={save} busy={busy} />
        {first ? (
          <Button
            label="Skip for now"
            variant="ghost"
            onPress={() => {
              // Skipping is still an answer: recorded so the question is not
              // asked again on every launch.
              void save();
            }}
          />
        ) : (
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        )}
      </View>

      <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
        Preferences are yours, not the household&apos;s — two people sharing a pantry can want different things from
        it.
      </Text>

      {/* Nothing is stored only on this device, so signing out loses nothing --
          but it is still a door people press by accident on the way past. */}
      {first ? null : (
        <Card>
          <View style={{ gap: space.md }}>
            <Eyebrow>Account</Eyebrow>
            <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
              Your pantry, plans and library stay with the household. Signing out only signs out this phone.
            </Text>
            <Button
              label="Sign out"
              variant="secondary"
              onPress={() =>
                Alert.alert('Sign out?', 'You can sign back in any time with the same email.', [
                  { text: 'Stay signed in', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
                ])
              }
            />
          </View>
        </Card>
      )}
    </ScrollView>
  );
}
