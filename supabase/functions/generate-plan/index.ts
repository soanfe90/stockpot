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

import { enforcePlan, STAPLES, type PlanLimits, type Purchase } from '../_shared/budget.ts';
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { activeProvider, generateStructured } from '../_shared/llm.ts';

const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

/** Aisles, for products the plan asks the household to buy. Mirrors CATEGORIES
 *  in src/lib/categories.ts, which is what the app renders and groups by. */
const CATEGORIES_FOR_BUYING = [
  'Produce', 'Meat & Fish', 'Dairy & Eggs', 'Bakery', 'Grains & Pasta',
  'Canned & Jarred', 'Frozen', 'Condiments & Spices', 'Snacks', 'Drinks', 'Other',
] as const;
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

/** ISO weekday of a plan day: 1 is Monday, 7 is Sunday. */
function isoWeekday(startsOn: string, dayOffset: number): number {
  const d = new Date(`${addDays(startsOn, dayOffset)}T00:00:00Z`);
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay();
}

/**
 * How far a plan may reach past the shelf, given when the household can
 * actually get to a shop.
 *
 * The weekdays they told us become plan-day offsets, which is the only form
 * the enforcer can use: "Saturday" means nothing to a check that works in days
 * from the start of the plan.
 *
 * The length of the shopping list scales with the number of trips rather than
 * being fixed. One weekly shop that has to carry seven days is not the moment
 * to buy eight new things: it is the moment to lean on the pantry and add two
 * or three that stretch a long way.
 */
function limitsFor(
  scope: 'single' | 'day' | 'week',
  startsOn: string,
  days: number,
  shoppingWeekdays: number[],
  fromScratch: boolean
): PlanLimits {
  // With nothing in the house there is no shelf to protect and no shelf to
  // fall back on: the plan is a shopping list with meals attached, and it can
  // be shopped for today whatever the usual weekday answer says.
  if (fromScratch) {
    return { shoppingDays: [0], maxNewProducts: 12, pantryOnlyDays: 0 };
  }

  // A single meal or a single day is today, and today is always the
  // household's own shelf -- there is no room in it for a trip to a shop.
  if (scope !== 'week') return { shoppingDays: [], maxNewProducts: 0, pantryOnlyDays: 1 };

  const shoppingDays: number[] = [];
  for (let offset = 0; offset < days; offset++) {
    if (shoppingWeekdays.includes(isoWeekday(startsOn, offset))) shoppingDays.push(offset);
  }

  return {
    shoppingDays,
    maxNewProducts: Math.min(12, shoppingDays.length * 5),
    pantryOnlyDays: 1,
  };
}

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
  source: z
    .enum(['pantry', 'staple', 'buy'])
    .describe(
      'pantry: already in the house, product_id required. staple: salt, oil, water and the like, ' +
        'never tracked. buy: the household does not have it and will need to buy it.'
    ),
  product_id: z.string().nullable().describe('An id from the pantry list for source "pantry", otherwise null'),
  name: z.string(),
  category: z
    .string()
    .nullable()
    .describe('For source "buy" only: which aisle it belongs to, from the category list given.'),
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

const SYSTEM_RULES = `You plan meals around a household's actual pantry.

Every ingredient states where it comes from:

- **pantry** -- already in the house. Give its exact product_id from the list.
  Across the whole plan these must never add up to more than the pantry holds.
- **staple** -- salt, pepper, water, cooking oil. Never tracked, never bought.
- **buy** -- the household does not have it and will need to buy it. product_id
  is null; give a name and a category.

Reaching for **buy** is allowed, and is how a thin pantry still gets a varied
week. It is also what sends someone to a supermarket, so it is bounded:

- The opening days of the plan must be entirely **pantry** and **staple**. The
  household has to be able to cook tonight without going anywhere.
- Never **buy** something the pantry already holds enough of. Look it up first.
- Introduce new things on as few days as possible, and reuse each one across
  several meals. Three meals built around one bought ingredient is one trip;
  three meals each needing their own is three trips, and that is a worse plan
  even if it reads better.
- Some items are already on the household's shopping list. Those are being
  bought anyway, so leaning on them costs nothing extra -- prefer them over
  anything new.
- If the pantry can carry the whole plan on its own, let it. A plan that needs
  no shopping at all is the best outcome, not a boring one.

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

Do not repeat a dish, or lean on the same few products meal after meal, just
because the pantry is small. That is exactly what **buy** is for: one or two
well-chosen additions should unlock a week that does not repeat itself.

If you still cannot fill the plan honestly, return fewer meals. Short and true
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
    /** ISO weekdays the household can get to a shop. Empty is a real answer:
     *  plan from the pantry alone. */
    shopping_days?: number[];
    /** Gemini model this member chose. Checked against an allowlist before it
     *  reaches an API; anything unrecognised falls back to the default. */
    model?: string | null;
    /**
     * Exactly which meals to fill, as day offsets and categories.
     *
     * The function used to work this out itself as "three a day for however
     * many days", which was three assumptions at once: that a household eats
     * three meals, that it eats them every day, and that a plan starting today
     * starts at breakfast even when it is seven in the evening. The client
     * knows all three answers; it should just say.
     */
    slots?: { day_offset: number; category: (typeof CATEGORIES)[number] }[];
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

    // Every meal of every *draft* plan, whether this one or another sitting
    // unapproved. Drafts hold no reservation, so product_stock has never heard
    // of them -- and two drafts blind to each other will plan the same food,
    // which is how a meal for today could come up short of a pantry that
    // looked, on its own numbers, perfectly able to cover it.
    {
      const query = supabase
        .from('meal_slot')
        .select('id, servings, plan:plan_id!inner (status), recipe:recipe_id (servings, recipe_ingredient (product_id, qty))')
        .eq('household_id', body.household_id)
        .eq('plan.status', 'draft');

      const { data: drafts } = replacing ? await query.neq('id', replacing.id) : await query;

      for (const sib of (drafts ?? []) as unknown as {
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

    // An empty pantry used to be refused. It is in fact the most useful moment
    // the app has: somebody who has just signed up and has nothing in wants to
    // be told what to buy, and a plan is exactly the thing that can tell them.
    const fromScratch = pantry.length === 0;
    if (fromScratch && replacing) {
      return fail('There is nothing left in the pantry to build a different meal from.', 409);
    }

    // The requested shape, or the old assumption for a caller that did not
    // send one.
    const requested = replacing
      ? [{ day_offset: 0, category: replacing.category }]
      : (body.slots?.length
          ? body.slots
          : defaultShape(body.scope === 'week' ? 7 : 1));

    const days = replacing ? 1 : Math.max(1, ...requested.map((s) => s.day_offset + 1));
    const wanted = requested.length;

    // A swap lives inside a plan that already made its shopping decisions, so
    // it gets no fresh allowance: it has to work with what is there.
    const limits = replacing
      ? // A swap lives inside a plan that already made its shopping decisions,
        // so it gets no fresh allowance: it works with what is there.
        { shoppingDays: [], maxNewProducts: 0, pantryOnlyDays: 1 }
      : limitsFor(body.scope, body.starts_on, days, body.shopping_days ?? [], fromScratch);

    // Things the household is already going to buy. Leaning on these costs no
    // extra trip, which makes them the cheapest variety available.
    const { data: listed } = await supabase
      .from('shopping_item')
      .select('name, qty, display_unit, needed_by, checked, list:list_id (status)')
      .eq('household_id', body.household_id)
      .eq('checked', false);

    const onTheList = ((listed ?? []) as unknown as {
      name: string;
      qty: number;
      display_unit: string;
      needed_by: string | null;
      list: { status: string } | null;
    }[])
      .filter((i) => i.list?.status !== 'closed')
      .map((i) => ({ name: i.name, qty: Number(i.qty), unit: i.display_unit, needed_by: i.needed_by }));

    let accepted: Slot[] = [];
    let violations: string[] = [];
    let notes: string | null = null;
    let purchases: Purchase[] = [];

    for (let attempt = 0; attempt < MAX_ATTEMPTS && accepted.length === 0; attempt++) {
      const parsed = await generateStructured({
        label: 'Building the plan',
        model: body.model ?? null,
        schema: PlanSchema,
        maxOutputTokens: 32000,
        system: [SYSTEM_RULES, '', `Untracked staples: ${STAPLES.join(', ')}.`].join('\n'),
        parts: [
          {
            type: 'text',
            text: [
              fromScratch
                ? `Pantry: empty. There is nothing in the house.`
                : `Pantry (sorted by what expires soonest):\n${JSON.stringify(pantry)}`,
              ``,
              `Recently cooked here, for reuse where it fits: ${JSON.stringify(history ?? [])}`,
              ``,
              `Already on the shopping list, so free to plan around: ${JSON.stringify(onTheList)}`,
              ``,
              `Categories for anything you ask them to buy: ${CATEGORIES_FOR_BUYING.join(', ')}.`,
              ``,
              fromScratch
                ? [
                    `This household has nothing in the pantry at all. Build the plan entirely from things`,
                    `they will buy -- every ingredient is "buy" except staples -- and keep the list tight:`,
                    `choose ingredients that carry across several meals rather than one dish each, because`,
                    `this list is what they will actually walk around a supermarket with.`,
                    `At most ${limits.maxNewProducts} different things.`,
                  ].join('\n')
                : limits.shoppingDays.length
                ? [
                    `This household can get to a shop on day_offset ${limits.shoppingDays.join(' and ')} of this plan,`,
                    `and nowhere else. Anything bought must therefore be first needed on or after one of those days --`,
                    `a meal on day 3 cannot use something they cannot buy until day 5.`,
                    `Day 0 is always from the pantry: they must be able to cook tonight without going anywhere.`,
                    `At most ${limits.maxNewProducts} different things may be bought across the whole plan.`,
                  ].join('\n')
                : `This household is not planning around a shop at all. Every ingredient must come from the pantry or be a staple.`,
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
                    `Fill exactly these meals, one dish each, and no others:`,
                    JSON.stringify(requested),
                    `day_offset 0 is ${body.starts_on}. Some days may want fewer meals than others,`,
                    `and some may be missing entirely -- that is the household's week, not an oversight`,
                    `to correct.`,
                  ].join('\n'),
              violations.length
                ? `\nYour previous attempt over-allocated the pantry:\n${violations.join('\n')}\nStay inside those amounts.`
                : '',
            ].join('\n'),
          },
        ],
      });

      notes = parsed.notes;
      const checked = enforcePlan(parsed.slots, pantry, limits);
      violations = checked.violations;
      accepted = checked.accepted;
      purchases = checked.purchases;
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
          // The shopping days go in with the preferences because the review
          // screen has to show which trips this plan assumes, and offer to
          // rebuild it on different ones.
          prefs: { ...(body.prefs ?? {}), shopping_days: body.shopping_days ?? [] },
        })
        .select()
        .single();
      if (planError) throw planError;
      plan = created;
    }

    // Everything the plan wants but the house does not have becomes a real
    // product with no stock in it. That is what lets the rest of the app carry
    // it without a single new mechanism: plan_shortfalls measures per product,
    // add_plan_gaps_to_list writes per product, closing a shopping trip stocks
    // per product, and cooking deducts per product. `planned` marks it as an
    // intention rather than something the household keeps, so it does not turn
    // up on the shopping list on its own account.
    const boughtIds = new Map<string, { id: string; base_unit: string }>();
    for (const item of purchases) {
      const { data: existing } = await supabase
        .from('product')
        .select('id, base_unit')
        .eq('household_id', body.household_id)
        .ilike('name', item.name)
        .maybeSingle();

      if (existing) {
        boughtIds.set(item.key, existing);
        continue;
      }

      const spec = specFor(accepted, item.key);
      const { data: created, error: createError } = await supabase
        .from('product')
        .insert({
          household_id: body.household_id,
          name: item.name,
          category: spec.category,
          base_unit: spec.base_unit,
          display_unit: spec.display_unit,
          planned: true,
        })
        .select('id, base_unit')
        .single();
      // A name that collided with an existing product is not worth failing a
      // whole plan over; the ingredient simply goes in untracked.
      if (createError || !created) continue;
      boughtIds.set(item.key, created);
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

      const ingredients = slot.ingredients.map((ing, index) => {
        // A bought line points at the product created for it above, so it is
        // indistinguishable downstream from one that was on the shelf all
        // along -- the only difference is that there is none of it yet.
        const bought = ing.source === 'buy' ? boughtIds.get(ing.name.trim().toLowerCase()) : undefined;
        const productId = ing.source === 'pantry' ? ing.product_id : (bought?.id ?? null);
        return {
          recipe_id: recipe.id,
          product_id: productId,
          name: ing.name,
          qty: Math.max(0, ing.qty),
          display_unit: ing.display_unit,
          base_unit:
            pantry.find((p) => p.product_id === productId)?.base_unit ?? bought?.base_unit ?? 'g',
          optional: ing.optional,
          position: index,
        };
      });
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

    // The shopping goes on the list the moment the plan exists, not when it is
    // approved. Approving is about reserving stock; knowing what to buy is
    // needed well before that -- and for a household with an empty pantry
    // there is nothing to reserve at all, so waiting would mean the list never
    // arrived. Discarding the plan takes its unticked rows back off again.
    if (!replacing) {
      const { error: gapError } = await supabase.rpc('add_plan_gaps_to_list', { p_plan_id: plan.id });
      // A list that did not update is worth reporting, but not worth throwing
      // away a written plan over.
      if (gapError) console.error('add_plan_gaps_to_list', gapError.message);
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
      // The shopping this plan commits them to: which days, and what for. The
      // review screen shows it before anything is approved, because a plan is
      // a claim on someone's week and not only on their pantry.
      trips: tripsOf(purchases, body.starts_on),
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

/**
 * The units and aisle for something the plan wants to buy, read off the first
 * line that asked for it. The model states these per ingredient; a product row
 * needs exactly one of each, and the first mention is as good as any.
 */
function specFor(slots: Slot[], k: string): { category: string; base_unit: string; display_unit: string } {
  for (const slot of slots) {
    for (const ing of slot.ingredients) {
      if (ing.source !== 'buy' || ing.name.trim().toLowerCase() !== k) continue;
      const unit = (ing.display_unit || 'g').trim();
      return {
        category: ing.category ?? 'Other',
        base_unit: unit === 'ml' || unit === 'l' ? 'ml' : unit === 'ud' || unit === 'unit' ? 'unit' : 'g',
        display_unit: unit,
      };
    }
  }
  return { category: 'Other', base_unit: 'g', display_unit: 'g' };
}

/** The purchases grouped into the trips that cover them, soonest first. */
function tripsOf(purchases: Purchase[], startsOn: string): { on: string; items: string[] }[] {
  const byDay = new Map<number, string[]>();
  for (const item of purchases) {
    if (item.shopOnDay === null) continue;
    byDay.set(item.shopOnDay, [...(byDay.get(item.shopOnDay) ?? []), item.name]);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, items]) => ({ on: addDays(startsOn, day), items: items.sort() }));
}

/** Three meals a day, which is what the function assumed before a caller could
 *  say otherwise. Kept for callers that still do not. */
function defaultShape(days: number): { day_offset: number; category: (typeof CATEGORIES)[number] }[] {
  const shape: { day_offset: number; category: (typeof CATEGORIES)[number] }[] = [];
  for (let day = 0; day < days; day++) {
    for (const category of ['breakfast', 'lunch', 'dinner'] as const) {
      shape.push({ day_offset: day, category });
    }
  }
  return shape;
}
