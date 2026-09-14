/**
 * generate-plan
 *
 * Turns what is actually in the pantry into a meal plan. The important word is
 * *actually*: a plan that calls for something you do not have breaks the core
 * promise of the app instantly, and free-form generation will do that
 * confidently. So the model is given the inventory as data, must reference
 * products by id from that list, and every plan is checked against real
 * quantities here before the user ever sees it.
 *
 * The model provider is chosen by LLM_PROVIDER (see _shared/llm.ts).
 *
 *   supabase functions deploy generate-plan
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4.6.1';

import { enforceBudget, STAPLES } from '../_shared/budget.ts';
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { activeProvider, generateStructured } from '../_shared/llm.ts';

const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const MAX_ATTEMPTS = 3;

/**
 * When each meal lands, in minutes from local midnight. These are only the
 * fallback: the household member's own times come in on the request, and are
 * the same numbers meal_offset() reads from user_profile.meal_times in SQL.
 */
const DEFAULT_MEAL_MINUTES: Record<(typeof CATEGORIES)[number], number> = {
  breakfast: 8 * 60,
  lunch: 13 * 60,
  dinner: 20 * 60,
  snack: 17 * 60,
};

type MealMinutes = Partial<Record<(typeof CATEGORIES)[number], number>>;

/** The meal a regeneration stands in for: its plan, its place and its time. */
type ReplacedSlot = {
  id: string;
  plan_id: string;
  recipe_id: string;
  category: (typeof CATEGORIES)[number];
  scheduled_at: string;
  servings: number;
  position: number;
  /** Draft plans reserve nothing; approved ones already hold their claim in
   *  product_stock. The pantry has to be read differently for each. */
  plan_status: string;
};

const IngredientSchema = z.object({
  product_id: z.string().nullable().describe('An id from the pantry list, or null for an untracked staple'),
  name: z.string(),
  qty: z
    .number()
    .positive()
    .describe(
      "Amount in the product's base unit (g, ml, or whole units). Always greater than zero -- " +
        'never 0 to signal that the pantry has run out.'
    ),
  display_unit: z.string(),
  optional: z.boolean(),
});

const SlotSchema = z.object({
  day_offset: z.number().describe('0 for the first day of the plan'),
  category: z.enum(CATEGORIES),
  name: z.string(),
  cuisine: z.string(),
  diet_types: z.array(z.string()),
  est_minutes: z.number(),
  servings: z.number(),
  total_calories: z.number(),
  steps: z.array(z.string()),
  tips: z.array(z.string()),
  ingredients: z.array(IngredientSchema),
});

const PlanSchema = z.object({
  slots: z.array(SlotSchema),
  notes: z.string().nullable().describe('One line on what this plan is trying to use up'),
});

type Slot = z.infer<typeof SlotSchema>;

const SYSTEM_RULES = `You plan meals from a household's actual pantry.

The single rule that matters: **every tracked ingredient must come from the
pantry list you are given, referenced by its exact product_id, and the whole
plan together must not use more of anything than the pantry holds.** A plan
that calls for food the household does not have is worse than no plan.

- Quantities are in each product's base unit, which the pantry list states for
  every item. Never switch units.
- Untracked staples (salt, pepper, water, cooking oil) may be used with
  product_id null. Nothing else may be null.
- Every ingredient's qty is what the dish actually needs, and is always greater
  than zero. Never list an ingredient at 0 because earlier meals have used the
  product up -- a recipe calling for none of something is not a recipe, and it
  hides the shortage instead of avoiding it. If what is left cannot cover a
  dish, choose a different dish.
- Work through what is closest to expiring first. The pantry list gives
  days_left for every item; a plan that rescues food about to be thrown away is
  the entire point of this app.
- Do not lean on one product repeatedly within a single day. Spread the pantry
  across the plan.
- Respect the household's diet types absolutely: they are a hard filter, not a
  preference. A vegan household never sees meat, even to use it up.
- Cuisines are a preference, not a filter. A sparse pantry beats a themed one.
- Steps should be usable while cooking: short, ordered, one action each.
- total_calories is for the whole recipe at the servings you state, not per
  portion. Estimate honestly rather than rounding to something tidy.

If the pantry cannot support a full plan, return fewer meals. Short and true
beats long and invented.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Use POST.', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('Missing Authorization header.', 401);

  let body: {
    household_id: string;
    scope: 'single' | 'day' | 'week';
    starts_on: string;
    prefs?: Record<string, unknown>;
    tz_offset_minutes?: number;
    meal_times?: MealMinutes;
    /** Set to swap one meal of an existing draft for a fresh suggestion,
     *  keeping its plan, its slot in the day, and its time. */
    replace_slot_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return fail('Send a JSON body.');
  }
  if (!body.household_id || !body.scope || !body.starts_on) {
    return fail('household_id, scope and starts_on are required.');
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  try {
    // A regeneration replaces one meal of an existing plan. An approved plan
    // holds reservations against its recipes; swap_slot moves that claim from
    // the old meal to its replacement in one transaction, so the two never
    // disagree about what the pantry owes.
    let replacing: ReplacedSlot | null = null;

    if (body.replace_slot_id) {
      const { data: slot, error: slotError } = await supabase
        .from('meal_slot')
        .select('id, plan_id, recipe_id, category, scheduled_at, servings, position, status, plan:plan_id (status)')
        .eq('id', body.replace_slot_id)
        .single();
      if (slotError || !slot) return fail('That meal no longer exists.', 404);
      if (slot.status !== 'planned') return fail('That meal is already underway.', 409);

      const planStatus = (slot.plan as unknown as { status: string })?.status;
      if (planStatus === 'cancelled' || planStatus === 'done') {
        return fail('That plan is finished. Build a new one instead.', 409);
      }
      replacing = { ...(slot as unknown as ReplacedSlot), plan_status: planStatus };
    }

    // Available means unreserved: an approved plan's claim is not up for grabs.
    const [{ data: products }, { data: stock }, { data: history }] = await Promise.all([
      supabase.from('product').select('id, name, category, base_unit, display_unit')
        .eq('household_id', body.household_id),
      supabase.from('product_stock').select('*').eq('household_id', body.household_id),
      supabase.from('cook_log').select('recipe_id, rating, recipe:recipe_id (name, cuisine, category)')
        .eq('household_id', body.household_id)
        .order('finished_at', { ascending: false })
        .limit(20),
    ]);

    const stockById = new Map((stock ?? []).map((s) => [s.product_id, s]));

    // Two corrections to what product_stock reports, and exactly one of them
    // applies at a time.
    //
    // A draft's other meals hold no reservation, so nothing in product_stock
    // knows about them: without subtracting them, a regenerated meal would be
    // free to spend the same food twice. An approved plan is the reverse --
    // its siblings are already inside qty_reserved, so subtracting them again
    // would double-count, and the meal being replaced is holding a claim that
    // its replacement is entitled to spend.
    const spentElsewhere = new Map<string, number>();
    const freedByReplaced = new Map<string, number>();

    if (replacing && replacing.plan_status !== 'draft') {
      const { data: held } = await supabase
        .from('reservation')
        .select('product_id, qty')
        .eq('slot_id', replacing.id);

      for (const r of (held ?? []) as { product_id: string; qty: number }[]) {
        freedByReplaced.set(r.product_id, (freedByReplaced.get(r.product_id) ?? 0) + Number(r.qty));
      }
    }

    if (replacing && replacing.plan_status === 'draft') {
      const { data: siblings } = await supabase
        .from('meal_slot')
        .select('servings, recipe:recipe_id (servings, recipe_ingredient (product_id, qty))')
        .eq('plan_id', replacing.plan_id)
        .neq('id', replacing.id);

      for (const sib of (siblings ?? []) as unknown as {
        servings: number;
        recipe: { servings: number; recipe_ingredient: { product_id: string | null; qty: number }[] } | null;
      }[]) {
        const per = Math.max(1, sib.recipe?.servings ?? 1);
        const scale = (sib.servings ?? per) / per;
        for (const ing of sib.recipe?.recipe_ingredient ?? []) {
          if (!ing.product_id) continue;
          spentElsewhere.set(ing.product_id, (spentElsewhere.get(ing.product_id) ?? 0) + Number(ing.qty) * scale);
        }
      }
    }

    const pantry = (products ?? [])
      .map((p) => {
        const s = stockById.get(p.id);
        const available =
          Number(s?.qty_total ?? 0) -
          Number(s?.qty_reserved ?? 0) +
          (freedByReplaced.get(p.id) ?? 0) -
          (spentElsewhere.get(p.id) ?? 0);
        return {
          product_id: p.id,
          name: p.name,
          category: p.category,
          base_unit: p.base_unit,
          available: Math.max(available, 0),
          days_left: daysUntil(s?.next_expiry ?? null),
        };
      })
      .filter((p) => p.available > 0)
      .sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999));

    if (pantry.length === 0) {
      return fail('There is nothing in the pantry to plan with yet. Add or scan some stock first.', 409);
    }

    const days = replacing ? 1 : body.scope === 'week' ? 7 : 1;
    const wanted = replacing || body.scope === 'single' ? 1 : days * 3;

    let accepted: Slot[] = [];
    let violations: string[] = [];
    let notes: string | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS && accepted.length === 0; attempt++) {
      const parsed = await generateStructured({
        label: 'Building the plan',
        schema: PlanSchema,
        maxOutputTokens: 32000,
        system: [SYSTEM_RULES, '', `Untracked staples: ${STAPLES.join(', ')}.`].join('\n'),
        parts: [
          {
            type: 'text',
            text: [
              `Pantry (sorted by what expires soonest):`,
              JSON.stringify(pantry),
              ``,
              `Recently cooked here, for reuse where it fits: ${JSON.stringify(history ?? [])}`,
              ``,
              `Preferences: ${JSON.stringify(body.prefs ?? {})}`,
              ``,
              replacing
                ? [
                    `Suggest exactly one ${replacing.category} for ${body.starts_on} (day_offset 0).`,
                    `It replaces a meal the household did not want, so make it a genuinely`,
                    `different dish -- not a variation on the same idea.`,
                    `The pantry amounts above already exclude what the rest of that day's`,
                    `meals are spoken for.`,
                  ].join('\n')
                : [
                    `Plan ${wanted} meal${wanted === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'},`,
                    `starting on ${body.starts_on} (day_offset 0).`,
                  ].join('\n'),
              violations.length
                ? `\nYour previous attempt over-allocated the pantry:\n${violations.join('\n')}\nStay inside those amounts.`
                : '',
            ].join('\n'),
          },
        ],
      });

      notes = parsed.notes;
      const checked = enforceBudget(parsed.slots, pantry);
      violations = checked.violations;
      accepted = checked.accepted;
    }

    if (accepted.length === 0) {
      return fail(
        'Could not build a plan that fits what is actually in the pantry. Try a shorter plan, or add stock first.',
        422
      );
    }

    // ---- write the plan --------------------------------------------------

    const tz = body.tz_offset_minutes ?? 0;
    const mealMinutes = body.meal_times ?? {};
    const endOffset = Math.max(...accepted.map((s) => s.day_offset));
    const endsOn = addDays(body.starts_on, endOffset);

    // A regeneration keeps the plan it belongs to; only a fresh plan makes one.
    let plan: { id: string };
    if (replacing) {
      plan = { id: replacing.plan_id };
    } else {
      const { data: created, error: planError } = await supabase
        .from('meal_plan')
        .insert({
          household_id: body.household_id,
          scope: body.scope,
          starts_on: body.starts_on,
          ends_on: endsOn,
          status: 'draft',
          prefs: body.prefs ?? {},
        })
        .select()
        .single();
      if (planError) throw planError;
      plan = created;
    }

    let position = replacing ? replacing.position : 0;
    let writtenSlotId: string | null = null;
    for (const slot of accepted) {
      const { data: recipe, error: recipeError } = await supabase
        .from('recipe')
        .insert({
          household_id: body.household_id,
          name: slot.name,
          category: slot.category,
          diet_types: slot.diet_types,
          cuisine: slot.cuisine,
          est_minutes: Math.round(slot.est_minutes),
          servings: Math.max(1, Math.round(slot.servings)),
          total_calories: Math.round(slot.total_calories),
          steps: slot.steps,
          tips: slot.tips,
          source: 'generated',
        })
        .select()
        .single();
      if (recipeError) throw recipeError;

      const ingredients = slot.ingredients.map((ing, index) => ({
        recipe_id: recipe.id,
        product_id: ing.product_id,
        name: ing.name,
        qty: Math.max(0, ing.qty),
        display_unit: ing.display_unit,
        base_unit: pantry.find((p) => p.product_id === ing.product_id)?.base_unit ?? 'g',
        optional: ing.optional,
        position: index,
      }));
      const { error: ingError } = await supabase.from('recipe_ingredient').insert(ingredients);
      if (ingError) throw ingError;

      // A replacement inherits the time of the meal it stands in for: the
      // household already decided when they are eating, only what changed.
      const scheduledAt = replacing
        ? new Date(replacing.scheduled_at)
        : mealTime(body.starts_on, slot.day_offset, slot.category, tz, mealMinutes);
      const { data: written, error: slotError } = await supabase
        .from('meal_slot')
        .insert({
          plan_id: plan.id,
          household_id: body.household_id,
          recipe_id: recipe.id,
          scheduled_at: scheduledAt.toISOString(),
          category: replacing ? replacing.category : slot.category,
          servings: Math.max(1, Math.round(slot.servings)),
          notify_at: new Date(scheduledAt.getTime() - 30 * 60_000).toISOString(),
          position: position++,
        })
        .select('id')
        .single();
      if (slotError) throw slotError;
      writtenSlotId = written.id;
    }

    // Everything above this line is additive: the replacement is written
    // unreserved, so a generation or a write that failed has changed nothing.
    // swap_slot is the only step that moves the claim, and it retires the old
    // meal and takes the new one's reservation in a single transaction -- there
    // is no moment where the plan holds two meals for one sitting, or none.
    let shortfall = 0;
    if (replacing && writtenSlotId) {
      const { data: swapped, error: swapError } = await supabase.rpc('swap_slot', {
        p_old_slot_id: replacing.id,
        p_new_slot_id: writtenSlotId,
      });
      if (swapError) throw swapError;
      shortfall = Number((swapped as { shortfall_units?: number } | null)?.shortfall_units ?? 0);
    }

    return json({
      provider: activeProvider(),
      plan_id: plan.id,
      slots: accepted.length,
      requested: wanted,
      notes,
      // Told plainly rather than hidden: a short plan the pantry can support is
      // the honest outcome, and the user should know why it is short.
      trimmed: wanted - accepted.length,
      violations,
      // Nonzero only when a swap inside an approved plan could not fully claim
      // what the replacement needs. Said plainly rather than hidden.
      shortfall_units: shortfall,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
});

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((target - today) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A local mealtime as a UTC instant.
 *
 * tz_offset_minutes is the client's offset *east* of UTC -- Madrid in summer
 * sends +120, Santiago sends -240 -- so the UTC instant is the local time
 * minus it. Adding it instead doubled the error in both directions, which is
 * how a one o'clock lunch came out at half past five in the morning.
 * apply_template applies it in the same direction in SQL.
 */
function mealTime(
  startsOn: string,
  dayOffset: number,
  category: (typeof CATEGORIES)[number],
  tzOffsetMinutes: number,
  mealMinutes: MealMinutes
): Date {
  const minutes = mealMinutes[category] ?? DEFAULT_MEAL_MINUTES[category];
  const base = new Date(`${addDays(startsOn, dayOffset)}T00:00:00Z`);
  base.setUTCMinutes(base.getUTCMinutes() + Math.round(minutes) - tzOffsetMinutes);
  return base;
}
