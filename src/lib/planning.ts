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
  /** The shopping this plan commits the household to: which days, and what
   *  for. Empty when the pantry carried the whole plan. */
  trips: { on: string; items: string[] }[];
};

export async function generatePlan(
  householdId: string,
  scope: PlanScope,
  startsOn: string,
  prefs: PlanPrefs,
  mealTimes?: MealTimes,
  shoppingDays?: number[],
  /** Abort the wait. The request is dropped; see cancelling in plan/create. */
  signal?: AbortSignal
): Promise<GenerateResult> {
  const { data, error } = await supabase.functions.invoke('generate-plan', {
    body: {
      household_id: householdId,
      scope,
      starts_on: startsOn,
      prefs,
      tz_offset_minutes: tzOffsetMinutes(),
      meal_times: mealTimes,
      shopping_days: shoppingDays,
    },
    signal,
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

/**
 * The trips a plan commits the household to, worked out from what it is short
 * of and the days that plan was built around.
 *
 * Derived here rather than carried from the generator, because the review
 * screen is reachable long after that response is gone -- and because a
 * shortfall can change under an approved plan when stock moves, which would
 * make a stored answer quietly wrong.
 */
export function tripsFor(
  plan: MealPlan,
  shortfalls: PlanShortfall[],
  shoppingWeekdays: number[]
): { on: string; items: string[] }[] {
  if (!shoppingWeekdays.length) return [];

  const start = new Date(`${plan.starts_on}T00:00:00`);
  const end = new Date(`${plan.ends_on}T00:00:00`);
  const span = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86_400_000));

  // Every day of the plan the household could shop on, as dates.
  const shopDates: string[] = [];
  for (let offset = 0; offset <= span; offset++) {
    const day = new Date(start);
    day.setDate(day.getDate() + offset);
    const iso = day.getDay() === 0 ? 7 : day.getDay();
    if (shoppingWeekdays.includes(iso)) shopDates.push(day.toISOString().slice(0, 10));
  }

  const byTrip = new Map<string, string[]>();
  for (const gap of shortfalls) {
    if (gap.shortfall <= 0) continue;
    // The last chance to buy it before it is wanted. Nothing earlier than the
    // deadline means it cannot be covered, and it is left out rather than
    // pinned to a trip that happens too late to be any use.
    const usable = shopDates.filter((d) => !gap.needed_by || d <= gap.needed_by);
    const trip = usable[usable.length - 1];
    if (!trip) continue;
    byTrip.set(trip, [...(byTrip.get(trip) ?? []), gap.product_name]);
  }

  return [...byTrip.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([on, items]) => ({ on, items: items.sort() }));
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
 * What this meal needs of one product, and how much of it the household
 * actually has. Quantities are in the product's base unit.
 */
export type Coverage = {
  /** Scaled to the servings this meal is for, not the recipe's own. */
  needed: number;
  covered: number;
  short: number;
};

/**
 * One meal with everything the editor needs: the recipe, its ingredients, the
 * status of the plan it belongs to -- which decides whether any of it can still
 * be changed -- and whether the pantry can actually cover each line.
 */
export async function loadMeal(slotId: string): Promise<{
  meal: ScheduledMeal;
  plan: MealPlan;
  ingredients: RecipeIngredient[];
  coverage: Record<string, Coverage>;
}> {
  const { data: slot, error } = await supabase
    .from('meal_slot')
    .select('*, recipe:recipe_id (*), plan:plan_id (*)')
    .eq('id', slotId)
    .single();
  if (error) throw error;

  const meal = slot as unknown as ScheduledMeal & { plan: MealPlan };
  const [{ data: ingredients, error: ingError }, { data: held }, { data: stock }] = await Promise.all([
    supabase.from('recipe_ingredient').select('*').eq('recipe_id', meal.recipe_id).order('position'),
    supabase.from('reservation').select('product_id, qty').eq('slot_id', slotId),
    supabase.from('product_stock').select('product_id, qty_total, qty_reserved').eq('household_id', meal.household_id),
  ]);
  if (ingError) throw ingError;

  const lines = (ingredients ?? []) as RecipeIngredient[];
  const scale = meal.servings / Math.max(1, meal.recipe.servings);

  // An approved meal is holding its own claim, so what covers it is that claim
  // -- free stock would read as short by exactly the amount it has reserved.
  // A draft holds nothing, so what covers it is what nobody else has spoken for.
  const reserved = new Map<string, number>();
  for (const r of (held ?? []) as { product_id: string; qty: number }[]) {
    reserved.set(r.product_id, (reserved.get(r.product_id) ?? 0) + Number(r.qty));
  }
  const free = new Map<string, number>();
  for (const s of (stock ?? []) as { product_id: string; qty_total: number; qty_reserved: number }[]) {
    free.set(s.product_id, Math.max(0, Number(s.qty_total) - Number(s.qty_reserved)));
  }

  const approved = meal.plan.status !== 'draft';
  const coverage: Record<string, Coverage> = {};
  for (const line of lines) {
    if (!line.product_id) continue;
    const needed = Number(line.qty) * scale;
    const has = approved ? (reserved.get(line.product_id) ?? 0) : (free.get(line.product_id) ?? 0);
    const covered = Math.min(needed, has);
    coverage[line.id] = { needed, covered, short: Math.max(0, needed - covered) };
  }

  return { meal, plan: meal.plan, ingredients: lines, coverage };
}

export async function approvePlan(planId: string): Promise<{ shortfall_units: number }> {
  const { data, error } = await supabase.rpc('approve_plan', { p_plan_id: planId });
  if (error) throw error;
  return data as { shortfall_units: number };
}

export async function cancelPlan(planId: string, householdId?: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_plan', { p_plan_id: planId });
  if (error) throw error;

  // Discarding a plan can orphan the products it invented for meals nobody
  // will now cook. Tidying them is a convenience, not part of cancelling, so a
  // failure here must not report a cancelled plan as still standing.
  if (householdId) {
    // The builder is thenable, not a Promise, so it has no .catch of its own.
    try {
      await supabase.rpc('prune_planned_products', { p_household_id: householdId });
    } catch {
      // Nothing to do: the plan is cancelled either way.
    }
  }
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
