import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorNote, Eyebrow, Field, Icon, Loading, TimeField } from '@/components/ui/kit';
import { Working } from '@/components/ui/working';
import { useInventory } from '@/hooks/use-inventory';
import { remindersAvailable, scheduleReminders } from '@/lib/notifications';
import {
  addIngredient,
  addPlanGaps,
  loadMeal,
  loadSchedule,
  regenerateSlot,
  removeIngredient,
  rescheduleSlot,
  setIngredientQty,
} from '@/lib/planning';
import { errorMessage } from '@/lib/supabase';
import { atMinutes, minutesOfDay } from '@/lib/time';
import type { Coverage } from '@/lib/planning';
import type { MealPlan, RecipeIngredient, ScheduledMeal, StockedProduct } from '@/lib/types';
import { formatQty, fromBase, parseQty, toBase } from '@/lib/units';
import { useHousehold } from '@/providers/household-provider';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

/**
 * One meal, and everything about it that can still be changed.
 *
 * What can be changed narrows as the meal gets closer to being cooked, and the
 * database is what decides: the time moves until someone starts cooking, and
 * the ingredients only while the plan is still a draft, because approving
 * reserves stock against exactly those quantities.
 */
export default function MealScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { household, profile } = useHousehold();
  const { products } = useInventory(household?.id ?? null);

  const [meal, setMeal] = useState<ScheduledMeal | null>(null);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [coverage, setCoverage] = useState<Record<string, Coverage>>({});
  const [minutes, setMinutes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // Separate from `busy`: only the model call is worth covering the screen for.
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await loadMeal(id);
      setMeal(data.meal);
      setPlan(data.plan);
      setIngredients(data.ingredients);
      setCoverage(data.coverage);
      setMinutes(minutesOfDay(data.meal.scheduled_at));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function saveTime() {
    if (!meal) return;
    void run(async () => {
      await rescheduleSlot(meal.id, atMinutes(new Date(meal.scheduled_at), minutes));
      // The reminder in the database moved with it; the ones already queued on
      // this phone did not. Re-queuing is a convenience, so a failure here must
      // not report the move itself as failed.
      if (household && remindersAvailable()) {
        await scheduleReminders(await loadSchedule(household.id)).catch(() => 0);
      }
    });
  }

  /** A swap keeps the plan, the slot and the time; only the dish changes. */
  function regenerate() {
    if (!meal || !household) return;
    Alert.alert(
      'Swap this meal?',
      plan?.status === 'draft'
        ? 'Stockpot suggests a different dish from what is left in the pantry.'
        : 'Stockpot suggests a different dish, and the ingredients this one is holding pass to it.',
      [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Swap',
        onPress: () => {
          setSwapping(true);
          void run(async () => {
            await regenerateSlot(household.id, meal.id, meal.scheduled_at.slice(0, 10), {
              diets: profile?.diet_types ?? [],
              cuisines: profile?.cuisines ?? [],
              goals: profile?.goals ?? [],
              servings: meal.servings,
            }, profile?.llm_model ?? null);
            // The old slot is gone, so there is nothing here to come back to.
            router.back();
          }).finally(() => setSwapping(false));
        },
      },
      ]
    );
  }

  if (loading) return <Loading />;
  if (!meal || !plan) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground, padding: space.lg }}>
        <ErrorNote message={error ?? 'That meal no longer exists.'} />
      </View>
    );
  }

  const draft = plan.status === 'draft';
  const movable = meal.status === 'planned';
  // Swapping works in an approved plan too: swap_slot moves the reservation
  // from the old meal to its replacement in one transaction. Only a meal
  // already on the stove is fixed, and only a finished plan has nothing to
  // swap within.
  const swappable = movable && (plan.status === 'draft' || plan.status === 'active');
  const timeChanged = minutes !== minutesOfDay(meal.scheduled_at);
  // Whole-plan gaps, not just this meal's: the shopping list works per plan,
  // and splitting one meal out of it would leave the rest quietly short.
  const missing = ingredients.filter((i) => (coverage[i.id]?.short ?? 0) > 0);
  const alreadyIn = new Set(ingredients.map((i) => i.product_id).filter(Boolean) as string[]);
  const addable = products.filter((p) => !alreadyIn.has(p.id) && p.qty_total - p.qty_reserved > 0);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}>
        <View style={{ gap: space.xs }}>
          <Eyebrow>{meal.category}</Eyebrow>
          <Text style={{ fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.4, color: t.ink }}>
            {meal.recipe.name}
          </Text>
          <Text style={{ fontSize: 13, color: t.inkFaint }}>
            {[
              meal.recipe.cuisine,
              meal.recipe.est_minutes ? `${meal.recipe.est_minutes} min` : null,
              `serves ${meal.servings}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        <ErrorNote message={error} />

        <Card>
          <View style={{ gap: space.lg }}>
            <TimeField
              label="Eating at"
              minutes={minutes}
              onChange={setMinutes}
              hint={
                movable
                  ? 'The reminder moves with it, 30 minutes before.'
                  : 'This meal is already underway, so its time is fixed.'
              }
            />
            {movable && timeChanged ? <Button label="Save time" onPress={saveTime} busy={busy} /> : null}
          </View>
        </Card>

        <View style={{ gap: space.md }}>
          <Eyebrow>Ingredients</Eyebrow>
          <View
            style={{
              borderRadius: radius.md,
              borderWidth: StyleSheet.hairlineWidth * 2,
              borderColor: t.line,
              overflow: 'hidden' }}>
            {ingredients.map((ing, index) => (
              <IngredientRow
                key={ing.id}
                ingredient={ing}
                coverage={coverage[ing.id]}
                first={index === 0}
                editable={draft}
                busy={busy}
                onSave={(qty) => void run(() => setIngredientQty(ing.id, qty))}
                onRemove={() => void run(() => removeIngredient(ing.id))}
              />
            ))}
          </View>

          {missing.length ? (
            <Card>
              <View style={{ gap: space.md }}>
                <Eyebrow color={t.urgent}>Not in the house</Eyebrow>
                <Text style={{ fontSize: 13, color: t.inkMuted, lineHeight: 19 }}>
                  {missing.length === 1 ? 'One ingredient is' : `${missing.length} ingredients are`} short of what this
                  meal needs. Put {missing.length === 1 ? 'it' : 'them'} on the shopping list and the amounts are
                  carried across, marked as needed for a meal so a list refresh cannot relabel them.
                </Text>
                <Button
                  label="Add what is missing to the shopping list"
                  variant="secondary"
                  busy={busy}
                  onPress={() =>
                    void run(async () => {
                      const added = await addPlanGaps(meal.plan_id);
                      Alert.alert(
                        added ? 'On your list' : 'Already on your list',
                        added
                          ? `${added} item${added === 1 ? '' : 's'} added under Shopping.`
                          : 'Everything this plan is short of is already there.'
                      );
                    })
                  }
                />
              </View>
            </Card>
          ) : null}

          <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
            {draft
              ? 'Untracked staples like salt and oil are never deducted from your pantry.'
              : 'This plan is approved, so its ingredients are reserved and can no longer be changed. Skip the meal to release them.'}
          </Text>
        </View>

        {draft && addable.length ? (
          adding ? (
            <AddIngredient
              products={addable}
              busy={busy}
              onCancel={() => setAdding(false)}
              onAdd={(productId, qty) => {
                setAdding(false);
                void run(() => addIngredient(meal.recipe_id, productId, qty));
              }}
            />
          ) : (
            <Button label="Add an ingredient" variant="secondary" onPress={() => setAdding(true)} />
          )
        ) : null}

        {swappable ? (
          <View style={{ gap: space.sm }}>
            <Button label="Swap for a different meal" variant="secondary" onPress={regenerate} busy={busy} />
            <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
              {draft
                ? 'Built from what is left once the rest of this plan is accounted for, so two meals never spend the same food.'
                : 'This meal is holding ingredients; its replacement takes them over, so nothing is released back to the shopping list by accident.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {swapping ? (
        <Working
          title="Finding another meal"
          steps={[
            'Reading what is left in the pantry…',
            'Choosing a different dish that fits it…',
            'Handing this meal\u2019s ingredients over to the new one…',
          ]}
          onCancel={() => setSwapping(false)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function IngredientRow({
  ingredient,
  coverage,
  first,
  editable,
  busy,
  onSave,
  onRemove }: {
  ingredient: RecipeIngredient;
  coverage?: Coverage;
  first: boolean;
  editable: boolean;
  busy: boolean;
  onSave: (qty: number) => void;
  onRemove: () => void;
}) {
  const t = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  // A staple carries no product, so there is no stock behind it to change.
  const tracked = ingredient.product_id !== null;
  const short = coverage?.short ?? 0;

  function save() {
    const value = parseQty(draft);
    if (value === null || value < 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setEditing(false);
    onSave(toBase(value, ingredient.base_unit, ingredient.display_unit));
  }

  return (
    <View
      style={{
        padding: space.lg,
        gap: space.md,
        backgroundColor: t.surface,
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 15, fontFamily: fonts.semibold, color: t.ink }}>
            {ingredient.name}
            {ingredient.optional ? (
              <Text style={{ fontSize: 12, color: t.inkFaint, fontFamily: fonts.medium }}> · optional</Text>
            ) : null}
          </Text>
          <Text style={{ fontSize: 12.5, color: t.inkFaint, fontVariant: ['tabular-nums'] }}>
            {tracked
              ? formatQty(Number(ingredient.qty), ingredient.base_unit, ingredient.display_unit)
              : 'Pantry staple — not tracked'}
          </Text>
          {/* The question this answers is "do I need to buy this?", and it
              cannot be answered by the recipe alone: the pantry has to be read
              against it. Silence here is what let a meal look complete when
              half of it was not in the house. */}
          {short > 0 ? (
            <Text style={{ fontSize: 12, color: t.urgent, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] }}>
              Short {formatQty(short, ingredient.base_unit, ingredient.display_unit)} — needs buying
            </Text>
          ) : tracked && coverage ? (
            <Text style={{ fontSize: 12, color: t.fresh, fontFamily: fonts.medium }}>In your pantry</Text>
          ) : null}
        </View>
        {editable && tracked && !editing ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${ingredient.name}`} onPress={onRemove} hitSlop={8}>
            <Icon name="close-circle-outline" size={20} color={t.inkFaint} />
          </Pressable>
        ) : null}
      </View>

      {editable && tracked ? (
        editing ? (
          <View style={{ gap: space.sm }}>
            <Field
              label="Use"
              value={draft}
              onChangeText={setDraft}
              keyboardType="decimal-pad"
              suffix={ingredient.display_unit}
              autoFocus
              hint={invalid ? 'That is not a quantity.' : undefined}
            />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Save" onPress={save} busy={busy} style={{ flex: 1 }} />
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDraft(String(fromBase(Number(ingredient.qty), ingredient.base_unit, ingredient.display_unit)));
              setEditing(true);
            }}>
            <Text style={{ color: t.accentText, fontSize: 13, fontFamily: fonts.semibold }}>Change the amount</Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

/** Added ingredients come from the pantry, never free text: a plan is only
 *  honest if every line can actually be deducted when the meal is cooked. */
function AddIngredient({
  products,
  busy,
  onAdd,
  onCancel }: {
  products: StockedProduct[];
  busy: boolean;
  onAdd: (productId: string, qty: number) => void;
  onCancel: () => void;
}) {
  const t = useTokens();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<StockedProduct | null>(null);
  const [qty, setQty] = useState('');
  const [invalid, setInvalid] = useState(false);

  const matches = products
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 6);

  function add() {
    if (!picked) return;
    const value = parseQty(qty);
    if (value === null || value <= 0) {
      setInvalid(true);
      return;
    }
    onAdd(picked.id, toBase(value, picked.base_unit, picked.display_unit));
  }

  return (
    <Card>
      <View style={{ gap: space.lg }}>
        <Eyebrow>Add an ingredient</Eyebrow>
        {picked ? (
          <>
            <View style={{ gap: 2 }}>
              <Text style={{ fontSize: 15, fontFamily: fonts.semibold, color: t.ink }}>{picked.name}</Text>
              <Text style={{ fontSize: 12.5, color: t.inkFaint, fontVariant: ['tabular-nums'] }}>
                {formatQty(picked.qty_total - picked.qty_reserved, picked.base_unit, picked.display_unit)} free
              </Text>
            </View>
            <Field
              label="Use"
              value={qty}
              onChangeText={setQty}
              keyboardType="decimal-pad"
              suffix={picked.display_unit}
              autoFocus
              hint={invalid ? 'Give an amount greater than zero.' : undefined}
            />
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button label="Add" onPress={add} busy={busy} style={{ flex: 1 }} />
              <Button label="Back" variant="secondary" onPress={() => setPicked(null)} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            <Field label="Search the pantry" value={query} onChangeText={setQuery} placeholder="Arroz" autoFocus />
            {matches.length === 0 ? (
              <Text style={{ fontSize: 13, color: t.inkFaint }}>Nothing in stock matches that.</Text>
            ) : (
              matches.map((p) => (
                <Pressable key={p.id} accessibilityRole="button" onPress={() => setPicked(p)}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: space.sm }}>
                    <Text style={{ fontSize: 14.5, color: t.ink }}>{p.name}</Text>
                    <Text style={{ fontSize: 12.5, color: t.inkFaint, fontVariant: ['tabular-nums'] }}>
                      {formatQty(p.qty_total - p.qty_reserved, p.base_unit, p.display_unit)}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
            <Button label="Cancel" variant="ghost" onPress={onCancel} />
          </>
        )}
      </View>
    </Card>
  );
}
