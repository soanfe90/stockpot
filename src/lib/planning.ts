/**
 * Planning and cooking, client side.
 *
 *   generate -> review -> approve (reserves stock) -> cook -> finish (deducts)
 *
 * Nothing here computes stock. Reserving, deducting and releasing all happen
 * in the database, under a row lock.
 */

import { errorMessage, supabase } from './supabase';
import type {
  CookDeduction,
  MealPlan,
  MealTimes,
  PlanScope,
  PlanShortfall,
  Recipe,
  RecipeIngredient,
  ScheduledMeal,
} from './types';

export type PlanPrefs = {
  diets: string[];
  cuisines: string[];
  goals: string[];
  servings: number;
};

/**
 * The offset the server needs is the household's distance *east* of UTC, which
 * is the negation of what JavaScript reports: getTimezoneOffset() counts the
 * other way. Every caller has to agree on this, so nobody derives it by hand.
 */
function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export type GenerateResult = {
  plan_id: string;
  slots: number;
  requested: number;
  notes: string | null;
  /** How many fewer meals than asked for. A short plan the pantry can support
   *  is the honest outcome, and the UI says so rather than hiding it. */
  trimmed: number;
  violations: string[];
};

export async function generatePlan(
  householdId: string,
  scope: PlanScope,
  startsOn: string,
  prefs: PlanPrefs,
  mealTimes?: MealTimes
): Promise<GenerateResult> {
  const { data, error } = await supabase.functions.invoke('generate-plan', {
    body: {
      household_id: householdId,
      scope,
      starts_on: startsOn,
      prefs,
      tz_offset_minutes: tzOffsetMinutes(),
      meal_times: mealTimes,
    },
  });
  if (error) throw new Error(await readFunctionError(error));
  return data as GenerateResult;
}

/**
 * Swaps one meal of a draft for a fresh suggestion, keeping its plan and its
 * place in the day. Only drafts: an approved plan's ingredients are reserved,
 * and rewriting a meal underneath a reservation would leave the two disagreeing
 * about what the pantry owes.
 */
export async function regenerateSlot(
  householdId: string,
  slotId: string,
  startsOn: string,
  prefs: PlanPrefs
): Promise<GenerateResult> {
  const { data, error } = await supabase.functions.invoke('generate-plan', {
    body: {
      household_id: householdId,
      scope: 'single',
      starts_on: startsOn,
      prefs,
      tz_offset_minutes: tzOffsetMinutes(),
      replace_slot_id: slotId,
    },
  });
  if (error) throw new Error(await readFunctionError(error));
  return data as GenerateResult;
}

/** Moves a meal. Time is not stock, so no reservation changes hands. */
export async function rescheduleSlot(slotId: string, when: Date): Promise<void> {
  const { error } = await supabase.rpc('reschedule_slot', {
    p_slot_id: slotId,
    p_scheduled_at: when.toISOString(),
  });
  if (error) throw error;
}

/** Corrections to a generated recipe, allowed only while nothing is reserved
 *  against it and it has never been cooked -- the database enforces both. */
export async function setIngredientQty(ingredientId: string, qty: number): Promise<void> {
  const { error } = await supabase.rpc('set_ingredient_qty', { p_ingredient_id: ingredientId, p_qty: qty });
  if (error) throw error;
}

export async function removeIngredient(ingredientId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_ingredient', { p_ingredient_id: ingredientId });
  if (error) throw error;
}

export async function addIngredient(recipeId: string, productId: string, qty: number): Promise<void> {
  const { error } = await supabase.rpc('add_ingredient', {
    p_recipe_id: recipeId,
    p_product_id: productId,
    p_qty: qty,
  });
  if (error) throw error;
}

export async function loadPlan(planId: string): Promise<{
  plan: MealPlan;
  meals: ScheduledMeal[];
  shortfalls: PlanShortfall[];
}> {
  const [planRes, slotRes, shortRes] = await Promise.all([
    supabase.from('meal_plan').select('*').eq('id', planId).single(),
    supabase
      .from('meal_slot')
      .select('*, recipe:recipe_id (*)')
      .eq('plan_id', planId)
      .order('scheduled_at'),
    supabase.rpc('plan_shortfalls', { p_plan_id: planId }),
  ]);
  if (planRes.error) throw planRes.error;
  if (slotRes.error) throw slotRes.error;

  return {
    plan: planRes.data as MealPlan,
    meals: (slotRes.data ?? []) as unknown as ScheduledMeal[],
    shortfalls: ((shortRes.data ?? []) as PlanShortfall[]).filter((s) => s.shortfall > 0),
  };
}

export async function loadRecipe(recipeId: string): Promise<{
  recipe: Recipe;
  ingredients: RecipeIngredient[];
}> {
  const [recipeRes, ingRes] = await Promise.all([
    supabase.from('recipe').select('*').eq('id', recipeId).single(),
    supabase.from('recipe_ingredient').select('*').eq('recipe_id', recipeId).order('position'),
  ]);
  if (recipeRes.error) throw recipeRes.error;
  if (ingRes.error) throw ingRes.error;
  return { recipe: recipeRes.data as Recipe, ingredients: (ingRes.data ?? []) as RecipeIngredient[] };
}

/**
 * One meal with everything the editor needs: the recipe, its ingredients, and
 * the status of the plan it belongs to -- which is what decides whether any of
 * it can still be changed.
 */
export async function loadMeal(slotId: string): Promise<{
  meal: ScheduledMeal;
  plan: MealPlan;
  ingredients: RecipeIngredient[];
}> {
  const { data: slot, error } = await supabase
    .from('meal_slot')
    .select('*, recipe:recipe_id (*), plan:plan_id (*)')
    .eq('id', slotId)
    .single();
  if (error) throw error;

  const meal = slot as unknown as ScheduledMeal & { plan: MealPlan };
  const { data: ingredients, error: ingError } = await supabase
    .from('recipe_ingredient')
    .select('*')
    .eq('recipe_id', meal.recipe_id)
    .order('position');
  if (ingError) throw ingError;

  return { meal, plan: meal.plan, ingredients: (ingredients ?? []) as RecipeIngredient[] };
}

export async function approvePlan(planId: string): Promise<{ shortfall_units: number }> {
  const { data, error } = await supabase.rpc('approve_plan', { p_plan_id: planId });
  if (error) throw error;
  return data as { shortfall_units: number };
}

export async function cancelPlan(planId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_plan', { p_plan_id: planId });
  if (error) throw error;
}

/** Puts whatever the plan is short of onto the shopping list, pinned. */
export async function addPlanGaps(planId: string): Promise<number> {
  const { data, error } = await supabase.rpc('add_plan_gaps_to_list', { p_plan_id: planId });
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function startCooking(slotId: string): Promise<void> {
  const { error } = await supabase.rpc('start_cooking', { p_slot_id: slotId });
  if (error) throw error;
}

export async function finishCooking(
  slotId: string,
  options: {
    servings?: number;
    rating?: number | null;
    comment?: string | null;
    photoUrl?: string | null;
    /** product_id -> amount actually used, in base units. */
    adjustments?: Record<string, number>;
  } = {}
): Promise<{ cook_log_id: string; deductions: CookDeduction[] }> {
  const { data, error } = await supabase.rpc('finish_cooking', {
    p_slot_id: slotId,
    p_servings: options.servings ?? null,
    p_rating: options.rating ?? null,
    p_comment: options.comment ?? null,
    p_photo_url: options.photoUrl ?? null,
    p_adjustments: options.adjustments ?? {},
  });
  if (error) throw error;
  return data as { cook_log_id: string; deductions: CookDeduction[] };
}

/** Everything still to cook, soonest first. The schedule is this list. */
export async function loadSchedule(householdId: string): Promise<ScheduledMeal[]> {
  const { data, error } = await supabase
    .from('meal_slot')
    .select('*, recipe:recipe_id (*)')
    .eq('household_id', householdId)
    .in('status', ['planned', 'cooking'])
    .order('scheduled_at');
  if (error) throw error;
  return (data ?? []) as unknown as ScheduledMeal[];
}

/** Skipping releases the claim, so the stock goes back to the pantry rather
 *  than staying locked to a meal nobody is cooking. */
export async function skipMeal(slotId: string): Promise<void> {
  const { error } = await supabase.rpc('skip_meal', { p_slot_id: slotId });
  if (error) throw error;
}

export function mealLabel(iso: string): string {
  const when = new Date(iso);
  const today = new Date();
  const sameDay = when.toDateString() === today.toDateString();
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today ${time}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (when.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // fall through
    }
  }
  return errorMessage(error);
}
