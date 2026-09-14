import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body,
  Button,
  Card,
  Chips,
  ErrorNote,
  Eyebrow,
  FloatingBar,
  Segmented,
  TimeField,
  Title,
  useFloatingBar,
} from '@/components/ui/kit';
import { Text } from '@/components/ui/text';
import { clearPantry } from '@/lib/planning';
import { errorMessage } from '@/lib/supabase';
import {
  CUISINES,
  DEFAULT_MEAL_TIMES,
  DEFAULT_SHOPPING_DAYS,
  DIET_TYPES,
  GOALS,
  LLM_MODELS,
  WEEKDAYS,
  type MealTimes,
} from '@/lib/types';
import { useHousehold } from '@/providers/household-provider';
import { useSession } from '@/providers/session-provider';
import type { ThemeMode } from '@/theme/theme-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useThemeMode, useTokens } from '@/theme/use-tokens';

/**
 * Everything the app keeps about a household and the person using it.
 *
 * This began as three questions asked at signup and grew until "preferences"
 * stopped describing it: mealtimes and shopping days are facts about a week,
 * the household card is an administrative action, and signing out is not a
 * preference at all. Grouping them by what they *are* is what makes a screen
 * this long navigable.
 *
 * It doubles as the signup questionnaire. On a first run only the two groups
 * that steer meal generation are shown -- asking somebody to pick a theme
 * before they have seen the app is noise between them and using it.
 */
export default function SettingsScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { household, profile, savePreferences, leaveHousehold } = useHousehold();
  const { signOut } = useSession();
  const { mode, setMode } = useThemeMode();
  const bar = useFloatingBar();

  const first = !profile?.onboarded_at;
  const [diets, setDiets] = useState<string[]>(profile?.diet_types ?? []);
  const [cuisines, setCuisines] = useState<string[]>(profile?.cuisines ?? []);
  const [goals, setGoals] = useState<string[]>(profile?.goals ?? []);
  const [mealTimes, setMealTimes] = useState<MealTimes>(profile?.meal_times ?? DEFAULT_MEAL_TIMES);
  const [shoppingDays, setShoppingDays] = useState<number[]>(profile?.shopping_days ?? DEFAULT_SHOPPING_DAYS);
  const [llmModel, setLlmModel] = useState<string>(profile?.llm_model ?? LLM_MODELS[0].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The invite goes out as a link and the code in plain text together. The
   * link only works on a phone that already has Stockpot -- a custom scheme
   * cannot install anything -- so the code has to be readable on its own for
   * everybody else.
   */
  async function shareInvite() {
    if (!household) return;
    const link = `stockpot://household?code=${household.invite_code}`;
    await Share.share({
      message:
        `Join our Stockpot pantry, "${household.name}".\n\n` +
        `Invite code: ${household.invite_code}\n\n` +
        `If you already have the app, this opens it straight to the right screen:\n${link}`,
    }).catch(() => undefined);
  }

  function confirmLeave() {
    if (!household) return;
    Alert.alert(
      `Leave ${household.name}?`,
      'You go back to the setup screen, where you can start a new household or join one with a code. ' +
        'If anyone else is still in this one, its pantry, plans and history stay with them — but if you are the ' +
        'last member, all of it is deleted and cannot be recovered.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await leaveHousehold();
              // The root layout routes to the setup screen on the next render,
              // so there is nothing to navigate to from here.
              if (result.deleted) {
                Alert.alert('Household deleted', 'You were the last member, so everything in it went with it.');
              }
            } catch (e) {
              setError(errorMessage(e));
            }
          } },
      ]
    );
  }

  /**
   * Starting the pantry over. Two different things get asked for under this,
   * so both are offered rather than guessed at: throwing out the stock, and
   * throwing out the record of what the household buys as well.
   */
  function confirmClear() {
    if (!household) return;
    Alert.alert(
      'Empty the pantry?',
      'Every lot of stock goes, and any plan holding it is cancelled first so nothing is left claiming food that ' +
        'no longer exists.\n\n' +
        'Keeping the product list means Stockpot still knows what you buy, so adding stock again is a tap. ' +
        'Deleting it removes them entirely, along with their movement history.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear stock only', style: 'destructive', onPress: () => void wipe(false) },
        { text: 'Delete everything', style: 'destructive', onPress: () => void wipe(true) },
      ]
    );
  }

  async function wipe(deleteProducts: boolean) {
    if (!household) return;
    setBusy(true);
    setError(null);
    try {
      const r = await clearPantry(household.id, deleteProducts);
      Alert.alert(
        'Pantry emptied',
        [
          `${r.lots_removed} lot${r.lots_removed === 1 ? '' : 's'} of stock removed.`,
          r.products_removed ? `${r.products_removed} product${r.products_removed === 1 ? '' : 's'} deleted.` : null,
          r.plans_cancelled
            ? `${r.plans_cancelled} plan${r.plans_cancelled === 1 ? '' : 's'} cancelled, and their ingredients released.`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePreferences({ diets, cuisines, goals, mealTimes, shoppingDays, llmModel });
      if (first) router.replace('/');
      else router.back();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: first ? insets.top + space.xxl : space.lg,
          paddingBottom: bar.clearance,
          gap: space.xl }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.md }}>
          <Title>{first ? 'How do you eat?' : 'Settings'}</Title>
          <Body>
            {first
              ? 'Two questions before you start. Both steer every meal Stockpot suggests, and both can be changed later.'
              : 'Everything Stockpot knows about how you eat, when you shop, and who shares your pantry.'}
          </Body>
        </View>

        <Group title="How you eat" note="A single plan can be adjusted without touching what is saved here.">
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
        </Group>

        <Group
          title="Your week"
          note="When you eat and when you can shop. Together these decide what a plan can ask of you.">
          <Card>
            <View style={{ gap: space.lg }}>
              <View style={{ gap: space.xs }}>
                <Eyebrow>Mealtimes</Eyebrow>
                <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
                  Every generated meal lands at one of these, and reminders come 30 minutes before.
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
            <View style={{ gap: space.md }}>
              <View style={{ gap: space.xs }}>
                <Eyebrow>Shopping days</Eyebrow>
                <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
                  This changes the meals you are offered, not just the list. Shopping once a week gets a plan that
                  leans harder on the pantry and asks for fewer things; twice gets more variety. Choose none and every
                  plan comes from stock alone.
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {WEEKDAYS.map((day) => (
                  <Toggle
                    key={day.value}
                    label={day.short}
                    accessibilityLabel={day.label}
                    on={shoppingDays.includes(day.value)}
                    onPress={() =>
                      setShoppingDays((prev) =>
                        prev.includes(day.value)
                          ? prev.filter((d) => d !== day.value)
                          : [...prev, day.value].sort((a, b) => a - b)
                      )
                    }
                  />
                ))}
              </View>
            </View>
          </Card>
        </Group>

        {first ? null : (
          <>
            <Group title="Household" note="Shared by everyone with the code below.">
              {household ? (
                <>
                  <Card>
                    <View style={{ gap: space.md }}>
                      <View style={{ gap: 2 }}>
                        <Text style={{ fontSize: 16, fontFamily: fonts.semibold, color: t.ink }}>{household.name}</Text>
                        <Text
                          style={{
                            fontSize: 12.5,
                            color: t.inkFaint,
                            letterSpacing: 1.5,
                            fontVariant: ['tabular-nums'] }}>
                          {household.invite_code}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
                        The code is the whole invitation, so send it only to people you want in your kitchen.
                      </Text>
                      <Button label="Send an invite" variant="secondary" onPress={() => void shareInvite()} />
                    </View>
                  </Card>

                  <Card>
                    <View style={{ gap: space.md }}>
                      <Eyebrow>Starting over</Eyebrow>
                      <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
                        A scan that went wrong should not have to be undone one product at a time.
                      </Text>
                      <Button label="Empty the pantry" variant="secondary" onPress={confirmClear} busy={busy} />
                      <Button label="Leave this household" variant="danger" onPress={confirmLeave} />
                    </View>
                  </Card>
                </>
              ) : null}
            </Group>

            <Group title="App" note="These apply to this phone and this account, not to the household.">
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
                    Applies straight away — this one is not waiting on Save. Stays on this device.
                  </Text>
                </View>
              </Card>

              <Card>
                <View style={{ gap: space.md }}>
                  <Eyebrow>How hard it thinks</Eyebrow>
                  <Segmented
                    options={LLM_MODELS.map((m) => ({ value: m.value, label: m.label }))}
                    value={llmModel}
                    onChange={setLlmModel}
                  />
                  <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>
                    {LLM_MODELS.find((m) => m.value === llmModel)?.hint}
                  </Text>
                  <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
                    Calls go through your own Gemini key, so this is your cost to trade against. Scanning stays quick
                    either way; it is week-long plans that gain the most.
                  </Text>
                </View>
              </Card>
            </Group>

            <Group title="Account">
              <Card>
                <View style={{ gap: space.md }}>
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
            </Group>
          </>
        )}

        <ErrorNote message={error} />

        <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
          These are yours, not the household&apos;s — two people sharing a pantry can want different things from it.
        </Text>
      </ScrollView>

      {/* Pinned, because this screen is long enough that a Save at the bottom
          of it is a Save nobody finds. */}
      <FloatingBar {...bar.props}>
        <Button label={first ? 'Save and start' : 'Save changes'} onPress={save} busy={busy} />
        {first ? (
          // Skipping is still an answer: recorded so the question is not asked
          // again on every launch.
          <Button label="Skip for now" variant="ghost" onPress={() => void save()} />
        ) : (
          <Button label="Cancel" variant="ghost" onPress={() => router.back()} />
        )}
      </FloatingBar>
    </View>
  );
}

/** A titled run of cards. What makes a screen this long readable is that every
 *  card belongs to a heading that says why it is here. */
function Group({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const t = useTokens();
  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 18, fontFamily: fonts.display, color: t.ink }}>{title}</Text>
        {note ? <Text style={{ fontSize: 12.5, color: t.inkFaint, lineHeight: 18 }}>{note}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** A day of the week, on or off. */
function Toggle({
  label,
  accessibilityLabel,
  on,
  onPress }: {
  label: string;
  accessibilityLabel: string;
  on: boolean;
  onPress: () => void;
}) {
  const t = useTokens();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        borderRadius: radius.pill,
        backgroundColor: on ? t.accent : t.surfaceAlt,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: on ? t.accent : t.line }}>
      <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: on ? t.onAccent : t.inkMuted }}>{label}</Text>
    </Pressable>
  );
}
