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
 *   supabase functions deploy generate-plan
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.124.0/helpers/zod';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4.6.1';

import { enforceBudget, STAPLES } from '../_shared/budget.ts';
import { corsHeaders, fail, json } from '../_shared/cors.ts';

const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const MAX_ATTEMPTS = 3;

/** When each meal lands, in local hours. */
const MEAL_HOUR: Record<(typeof CATEGORIES)[number], number> = {
  breakfast: 8,
  lunch: 13.5,
  dinner: 20.5,
  snack: 17,
};

const IngredientSchema = z.object({
  product_id: z.string().nullable().describe('An id from the pantry list, or null for an untracked staple'),
  name: z.string(),
  qty: z.number().describe("Amount in the product's base unit (g, ml, or whole units)"),
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

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!anthropicKey) return fail('ANTHROPIC_API_KEY is not set on this project.', 500);

  let body: {
    household_id: string;
    scope: 'single' | 'day' | 'week';
    starts_on: string;
    prefs?: Record<string, unknown>;
    tz_offset_minutes?: number;
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
    const pantry = (products ?? [])
      .map((p) => {
        const s = stockById.get(p.id);
        const available = Number(s?.qty_total ?? 0) - Number(s?.qty_reserved ?? 0);
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

    const days = body.scope === 'week' ? 7 : 1;
    const wanted = body.scope === 'single' ? 1 : days * 3;

    const anthropic = new Anthropic({ apiKey: anthropicKey });

    let accepted: Slot[] = [];
    let violations: string[] = [];
    let notes: string | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS && accepted.length === 0; attempt++) {
      const response = await anthropic.beta.messages.parse({
        model: 'claude-opus-5',
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'high', format: zodOutputFormat(PlanSchema) },
        system: [
          { type: 'text', text: SYSTEM_RULES },
          {
            type: 'text',
            text: `Untracked staples: ${STAPLES.join(', ')}.`,
            // Rules and the staples list are the same on every call; the
            // pantry and the request are not. Regenerating reads warm.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
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
                  `Plan ${wanted} meal${wanted === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'},`,
                  `starting on ${body.starts_on} (day_offset 0).`,
                  violations.length
                    ? `\nYour previous attempt over-allocated the pantry:\n${violations.join('\n')}\nStay inside those amounts.`
                    : '',
                ].join('\n'),
              },
            ],
          },
        ],
      });

      if (response.stop_reason === 'refusal') {
        return fail('The model declined to plan this. Try adjusting your preferences.', 502);
      }
      const parsed = response.parsed_output;
      if (!parsed) continue;

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
    const endOffset = Math.max(...accepted.map((s) => s.day_offset));
    const endsOn = addDays(body.starts_on, endOffset);

    const { data: plan, error: planError } = await supabase
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

    let position = 0;
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

      const scheduledAt = mealTime(body.starts_on, slot.day_offset, slot.category, tz);
      const { error: slotError } = await supabase.from('meal_slot').insert({
        plan_id: plan.id,
        household_id: body.household_id,
        recipe_id: recipe.id,
        scheduled_at: scheduledAt.toISOString(),
        category: slot.category,
        servings: Math.max(1, Math.round(slot.servings)),
        notify_at: new Date(scheduledAt.getTime() - 30 * 60_000).toISOString(),
        position: position++,
      });
      if (slotError) throw slotError;
    }

    return json({
      plan_id: plan.id,
      slots: accepted.length,
      requested: wanted,
      notes,
      // Told plainly rather than hidden: a short plan the pantry can support is
      // the honest outcome, and the user should know why it is short.
      trimmed: wanted - accepted.length,
      violations,
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

/** Local mealtime, converted to UTC using the offset the client reported. */
function mealTime(startsOn: string, dayOffset: number, category: keyof typeof MEAL_HOUR, tzOffsetMinutes: number): Date {
  const hour = MEAL_HOUR[category];
  const base = new Date(`${addDays(startsOn, dayOffset)}T00:00:00Z`);
  base.setUTCMinutes(base.getUTCMinutes() + Math.round(hour * 60) + tzOffsetMinutes);
  return base;
}
