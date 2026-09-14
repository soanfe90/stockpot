import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, ErrorNote, Eyebrow, Field, Loading } from '@/components/ui/kit';
import { finishCooking, loadRecipe, mealLabel, startCooking } from '@/lib/planning';
import { errorMessage, supabase } from '@/lib/supabase';
import type { CookDeduction, MealSlot, Recipe, RecipeIngredient } from '@/lib/types';
import { formatQty } from '@/lib/units';
import { fonts, radius, space } from '@/theme/tokens';
import { useTokens } from '@/theme/use-tokens';

type Stage = 'cooking' | 'summary' | 'done';

export default function CookScreen() {
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Hands are covered in flour; the screen should not sleep mid-recipe.
  useKeepAwake();

  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [stage, setStage] = useState<Stage>('cooking');
  const [servings, setServings] = useState('2');
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [deductions, setDeductions] = useState<CookDeduction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error: slotError } = await supabase.from('meal_slot').select('*').eq('id', id).single();
      if (slotError) throw slotError;
      const loaded = data as MealSlot;
      setSlot(loaded);
      setServings(String(loaded.servings));
      const { recipe: r, ingredients: ing } = await loadRecipe(loaded.recipe_id);
      setRecipe(r);
      setIngredients(ing);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function begin() {
    if (!id) return;
    try {
      await startCooking(id);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function finish() {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const result = await finishCooking(id, {
        servings: Math.max(1, Number.parseInt(servings, 10) || 1),
        rating,
        comment: comment.trim() || null });
      setDeductions(result.deductions);
      setStage('done');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (!recipe || !slot) {
    return (
      <View style={{ flex: 1, backgroundColor: t.ground, padding: space.lg }}>
        <ErrorNote message={error ?? 'That meal no longer exists.'} />
      </View>
    );
  }

  const scale = (Number.parseInt(servings, 10) || slot.servings) / Math.max(recipe.servings, 1);

  /* ------------------------------------------------------------- done -- */

  if (stage === 'done') {
    const short = deductions.filter((d) => d.taken < d.wanted - 0.001);
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: t.ground }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Eyebrow color={t.fresh}>Finished</Eyebrow>
          <Text style={{ fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.4, color: t.ink }}>{recipe.name}</Text>
          <Text style={{ fontSize: 13, color: t.inkMuted, lineHeight: 19 }}>
            These amounts have come out of your pantry.
          </Text>
        </View>

        <View style={{ borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: t.line, overflow: 'hidden' }}>
          {deductions.map((d, index) => (
            <View
              key={d.product_id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                padding: space.lg,
                backgroundColor: t.surface,
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: t.line }}>
              <Text style={{ fontSize: 14.5, color: t.ink }}>{d.name}</Text>
              <Text style={{ fontSize: 14, color: t.inkMuted, fontVariant: ['tabular-nums'] }}>
                {d.taken} {d.unit}
              </Text>
            </View>
          ))}
        </View>

        {short.length ? (
          <Card>
            <Text style={{ fontSize: 13, color: t.inkMuted, lineHeight: 19 }}>
              {short.map((d) => d.name).join(', ')} ran out part-way. Your pantry now shows zero for
              {short.length === 1 ? ' it' : ' them'}, and the shopping list will pick
              {short.length === 1 ? ' it' : ' them'} up.
            </Text>
          </Card>
        ) : null}

        <Button label="Back to meals" onPress={() => router.replace('/plan')} />
      </ScrollView>
    );
  }

  /* ---------------------------------------------------------- summary -- */

  if (stage === 'summary') {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: t.ground }}
        contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + space.xxl, gap: space.xl }}
        keyboardShouldPersistTaps="handled">
        <View style={{ gap: space.sm }}>
          <Eyebrow>How did it go</Eyebrow>
          <Text style={{ fontSize: 24, fontFamily: fonts.bold, letterSpacing: -0.4, color: t.ink }}>{recipe.name}</Text>
        </View>

        <ErrorNote message={error} />

        <Field
          label="Servings actually made"
          value={servings}
          onChangeText={setServings}
          keyboardType="number-pad"
          suffix="people"
          hint="Ingredients are deducted at this scale, not the plan's."
        />

        <View style={{ gap: space.sm }}>
          <Eyebrow>Rating</Eyebrow>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`${value} out of 5`}
                onPress={() => setRating(value)}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: radius.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: StyleSheet.hairlineWidth * 2,
                  borderColor: rating && value <= rating ? t.accent : t.line,
                  backgroundColor: rating && value <= rating ? t.accentWash : t.surface }}>
                <Text style={{ fontSize: 16, fontFamily: fonts.bold, color: rating && value <= rating ? t.accentText : t.inkFaint }}>
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field
          label="Notes"
          value={comment}
          onChangeText={setComment}
          placeholder="Anything worth remembering next time"
          multiline
        />

        <View style={{ gap: space.sm }}>
          <Button label="Finish and update pantry" onPress={finish} busy={busy} />
          <Button label="Back to the recipe" variant="ghost" onPress={() => setStage('cooking')} />
        </View>
      </ScrollView>
    );
  }

  /* ---------------------------------------------------------- cooking -- */

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: insets.bottom + 110, gap: space.xl }}>
        <View style={{ gap: space.sm }}>
          <Eyebrow color={t.accentText}>
            {mealLabel(slot.scheduled_at)} · {slot.category}
          </Eyebrow>
          <Text style={{ fontSize: 26, fontFamily: fonts.bold, letterSpacing: -0.5, color: t.ink }}>{recipe.name}</Text>
          <Text style={{ fontSize: 13, color: t.inkFaint }}>
            {[
              recipe.cuisine,
              recipe.est_minutes ? `${recipe.est_minutes} min` : null,
              recipe.total_calories ? `${recipe.total_calories} kcal total` : null,
              `serves ${slot.servings}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>

        <ErrorNote message={error} />

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
                  {formatQty(ing.qty * scale, ing.base_unit, ing.display_unit)}
                </Text>
              </View>
            ))}
          </View>
          <Text style={{ fontSize: 12, color: t.inkFaint, lineHeight: 17 }}>
            Scaled for {servings}. Untracked staples are not deducted from your pantry.
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          <Eyebrow>Method</Eyebrow>
          {recipe.steps.map((step, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: space.md }}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: fonts.bold,
                  color: t.accentText,
                  fontVariant: ['tabular-nums'],
                  paddingTop: 3,
                  minWidth: 20 }}>
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
        {slot.status === 'cooking' ? (
          <Button label="Done cooking" onPress={() => setStage('summary')} />
        ) : (
          <Button label="Start cooking" onPress={begin} />
        )}
      </View>
    </View>
  );
}
