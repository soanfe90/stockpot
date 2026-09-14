/**
 * The check that makes a generated plan trustworthy.
 *
 * Kept apart from the Edge Function so it can be tested without a Deno
 * runtime: it is the piece that decides whether a plan is honest about what
 * the pantry holds, and it should never ship unexercised.
 *
 * It used to be only a budget -- every ingredient had to come off the shelf,
 * and a meal that overdrew was dropped. That is right for a full pantry and a
 * cage for a sparse one: with forty products the planner could only recombine
 * the same handful of things, and a week of meals repeated itself.
 *
 * So a plan may now reach past the shelf, under rules that keep it honest and
 * keep the household out of the shop:
 *
 *   - the first days come entirely from what is already in;
 *   - nothing is bought that the house already has enough of;
 *   - new things are introduced on a handful of days, not scattered across
 *     every one of them, because each of those days is a trip to the shop.
 */

/** Ingredients the app does not track and recipes may assume. */
export const STAPLES = [
  'salt', 'pepper', 'water', 'oil', 'olive oil',
  'sal', 'pimienta', 'agua', 'aceite',
];

/**
 * Where an ingredient comes from. Stated by the model rather than inferred,
 * because "no product_id" used to mean "staple" and now has to be able to mean
 * "something the household needs to buy" as well -- and guessing which from
 * the name is exactly the sort of silent wrong answer this module exists to
 * prevent.
 */
export type IngredientSource = 'pantry' | 'staple' | 'buy';

export type PlanIngredient = {
  product_id: string | null;
  name: string;
  qty: number;
  optional: boolean;
  source: IngredientSource;
};

export type PlanSlot = {
  day_offset: number;
  name: string;
  ingredients: PlanIngredient[];
};

export type PantryItem = { product_id: string; name: string; available: number };

export type PlanLimits = {
  /** Days from the start that must come entirely from the pantry, so the
   *  household can cook tonight without going anywhere. */
  pantryOnlyDays: number;
  /** Distinct days on which something new is first needed. Each one is a trip
   *  to the shop, which is the cost this whole feature has to stay inside. */
  maxShoppingDays: number;
  /** Distinct products the plan may ask the household to buy. */
  maxNewProducts: number;
};

/** One thing the plan wants that the house does not have. */
export type Purchase = {
  /** Lower-cased and trimmed; what the plan is keyed by. */
  key: string;
  name: string;
  /** Total across every meal that wants it, unscaled by servings. */
  qty: number;
  /** The plan day it is first needed on -- the deadline for buying it. */
  firstNeededDay: number;
};

export type PlanVerdict<S extends PlanSlot> = {
  accepted: S[];
  violations: string[];
  purchases: Purchase[];
};

const key = (name: string) => name.trim().toLowerCase();

/**
 * Walks the plan in day order, spending a running budget per pantry product
 * and collecting what has to be bought. A slot that breaks a rule is dropped
 * rather than served, so what survives is a real prefix of the plan rather
 * than an arbitrary subset -- and every reason is reported, both to tell the
 * user and to steer the next attempt.
 */
export function enforcePlan<S extends PlanSlot>(
  slots: S[],
  pantry: PantryItem[],
  limits: PlanLimits
): PlanVerdict<S> {
  const byDay = [...slots].sort((a, b) => a.day_offset - b.day_offset);
  const violations: string[] = [];

  let accepted = allocate(byDay, pantry, limits, violations);

  // Plan-level limits can only be judged once it is known which slots survived,
  // and dropping one can free a whole shopping day. Trimming repeats until the
  // plan is inside its limits -- normally never, because the retry loop feeds
  // these same violations back to the model first. This is the guarantee that
  // holds when the retries are spent.
  for (let guard = 0; guard < byDay.length; guard++) {
    const purchases = collect(accepted);
    const days = new Set(purchases.map((p) => p.firstNeededDay));
    if (purchases.length <= limits.maxNewProducts && days.size <= limits.maxShoppingDays) break;

    const victim = costliest(accepted, purchases, limits);
    if (!victim) break;

    violations.push(
      purchases.length > limits.maxNewProducts
        ? `The plan asks the household to buy ${purchases.length} different things; ${limits.maxNewProducts} is the most it may. Build more meals around what is already in.`
        : `The plan needs shopping on ${days.size} separate days; ${limits.maxShoppingDays} is the most it may. Introduce new ingredients together, and reuse them across meals.`
    );

    accepted = allocate(
      byDay.filter((s) => accepted.includes(s) && s !== victim),
      pantry,
      limits,
      []
    );
  }

  return { accepted, violations, purchases: collect(accepted) };
}

/** One pass: per-slot rules, then the running pantry budget, in day order. */
function allocate<S extends PlanSlot>(
  byDay: S[],
  pantry: PantryItem[],
  limits: PlanLimits,
  violations: string[]
): S[] {
  const remaining = new Map(pantry.map((p) => [p.product_id, p.available]));
  const stocked = new Map(pantry.map((p) => [key(p.name), p.available]));
  const accepted: S[] = [];

  for (const slot of byDay) {
    const spend = new Map<string, number>();
    let ok = true;

    for (const ing of slot.ingredients) {
      // An ingredient of no amount is the model working around this check
      // rather than obeying it: told a product is spent, it would list the
      // product at zero and the slot would pass. What reached the kitchen was
      // a recipe calling for "0 g tomatoes", which reserves nothing, deducts
      // nothing, and never reaches the shopping list -- an invisible hole in a
      // plan that looked complete.
      //
      // Checked before the optional skip, because "optional" means the cook
      // may leave it out, not that it has no size.
      if (!(ing.qty > 0)) {
        violations.push(
          `"${slot.name}" lists ${ing.name} with no amount. State what the dish actually needs, ` +
            `or choose a dish the pantry can cover.`
        );
        ok = false;
        continue;
      }

      if (ing.source === 'staple') {
        // Only the whitelist may go untracked; anything else is invention.
        if (!STAPLES.includes(key(ing.name))) {
          violations.push(
            `"${slot.name}" calls ${ing.name} a staple, but it is not one. Use it from the pantry, or buy it.`
          );
          ok = false;
        }
        continue;
      }

      if (ing.source === 'buy') {
        if (slot.day_offset < limits.pantryOnlyDays) {
          violations.push(
            `"${slot.name}" is on day ${slot.day_offset} and needs ${ing.name} bought. The first ` +
              `${limits.pantryOnlyDays} day${limits.pantryOnlyDays === 1 ? '' : 's'} must come entirely from the pantry.`
          );
          ok = false;
          continue;
        }
        // Buying what is already in the house is the worst outcome of the two
        // failure modes here: it sends someone to the shop for nothing.
        const have = stocked.get(key(ing.name)) ?? 0;
        if (have >= ing.qty) {
          violations.push(
            `"${slot.name}" wants to buy ${ing.name}, but there is already ${have} of it in the pantry. Use it.`
          );
          ok = false;
        }
        continue;
      }

      if (!ing.product_id || !remaining.has(ing.product_id)) {
        violations.push(`"${slot.name}" references a product that is not in the pantry.`);
        ok = false;
        continue;
      }

      // Optional ingredients are not budgeted: the cook may leave them out,
      // and reserving for them would starve meals that actually need the stock.
      if (ing.optional) continue;

      spend.set(ing.product_id, (spend.get(ing.product_id) ?? 0) + ing.qty);
    }

    if (ok) {
      for (const [productId, qty] of spend) {
        const left = remaining.get(productId) ?? 0;
        // A hair of tolerance for floating point, not for over-allocation.
        if (qty > left + 1e-6) {
          const item = pantry.find((p) => p.product_id === productId);
          violations.push(
            `"${slot.name}" wants ${qty} of ${item?.name ?? productId}, but only ${left} is left unspent.`
          );
          ok = false;
        }
      }
    }

    if (!ok) continue;
    for (const [productId, qty] of spend) remaining.set(productId, (remaining.get(productId) ?? 0) - qty);
    accepted.push(slot);
  }

  return accepted;
}

/** Everything the accepted meals need that the house does not have. */
function collect<S extends PlanSlot>(accepted: S[]): Purchase[] {
  const found = new Map<string, Purchase>();

  for (const slot of accepted) {
    for (const ing of slot.ingredients) {
      if (ing.source !== 'buy') continue;
      const k = key(ing.name);
      const seen = found.get(k);
      if (seen) {
        seen.qty += ing.qty;
        seen.firstNeededDay = Math.min(seen.firstNeededDay, slot.day_offset);
      } else {
        found.set(k, { key: k, name: ing.name.trim(), qty: ing.qty, firstNeededDay: slot.day_offset });
      }
    }
  }

  return [...found.values()].sort((a, b) => a.firstNeededDay - b.firstNeededDay || a.key.localeCompare(b.key));
}

/**
 * The slot whose removal buys the most, when a plan is over its limits.
 *
 * Latest first, because the early days are the ones the household will
 * actually cook before anything changes; and among those, one that is the sole
 * reason for a purchase, because dropping it retires a whole product -- and
 * possibly a whole trip to the shop -- rather than trimming a quantity.
 */
function costliest<S extends PlanSlot>(accepted: S[], purchases: Purchase[], limits: PlanLimits): S | null {
  const tooManyDays = new Set(purchases.map((p) => p.firstNeededDay)).size > limits.maxShoppingDays;
  const latestDay = tooManyDays ? Math.max(...purchases.map((p) => p.firstNeededDay)) : null;

  const users = new Map<string, number>();
  for (const slot of accepted) {
    for (const k of new Set(slot.ingredients.filter((i) => i.source === 'buy').map((i) => key(i.name)))) {
      users.set(k, (users.get(k) ?? 0) + 1);
    }
  }

  const candidates = accepted
    .filter((s) => s.ingredients.some((i) => i.source === 'buy'))
    .filter((s) => latestDay === null || s.day_offset === latestDay)
    .sort((a, b) => b.day_offset - a.day_offset);

  const sole = candidates.find((s) =>
    s.ingredients.some((i) => i.source === 'buy' && (users.get(key(i.name)) ?? 0) === 1)
  );

  return sole ?? candidates[0] ?? null;
}
