/**
 * The check that makes a generated plan trustworthy.
 *
 * Kept apart from the Edge Function so it can be tested without a Deno
 * runtime: it is the piece that decides whether a plan is honest about what
 * the pantry holds, and it should never ship unexercised.
 */

/** Ingredients the app does not track and recipes may assume. */
export const STAPLES = [
  'salt', 'pepper', 'water', 'oil', 'olive oil',
  'sal', 'pimienta', 'agua', 'aceite',
];

export type PlanIngredient = {
  product_id: string | null;
  name: string;
  qty: number;
  optional: boolean;
};

export type PlanSlot = {
  day_offset: number;
  name: string;
  ingredients: PlanIngredient[];
};

export type PantryItem = { product_id: string; name: string; available: number };

/**
 * Walks the plan in day order, spending a running budget per product. A slot
 * that would overdraw is dropped rather than served, so what survives is a
 * real prefix of the plan rather than an arbitrary subset -- and every reason
 * is reported, both to tell the user and to steer the next attempt.
 */
export function enforceBudget(
  slots: PlanSlot[],
  pantry: PantryItem[]
): { accepted: PlanSlot[]; violations: string[] } {
  const remaining = new Map(pantry.map((p) => [p.product_id, p.available]));
  const accepted: PlanSlot[] = [];
  const violations: string[] = [];

  for (const slot of [...slots].sort((a, b) => a.day_offset - b.day_offset)) {
    const spend = new Map<string, number>();
    let ok = true;

    for (const ing of slot.ingredients) {
      if (!ing.product_id) {
        // Only the whitelist may go untracked; anything else is invention.
        if (!STAPLES.includes(ing.name.trim().toLowerCase())) {
          violations.push(`"${slot.name}" uses "${ing.name}", which is not in the pantry.`);
          ok = false;
        }
        continue;
      }
      if (!remaining.has(ing.product_id)) {
        violations.push(`"${slot.name}" references a product that is not in the pantry.`);
        ok = false;
        continue;
      }
      // Optional ingredients are not budgeted: the cook may leave them out,
      // and reserving for them would starve meals that actually need the stock.
      if (ing.optional) continue;
      spend.set(ing.product_id, (spend.get(ing.product_id) ?? 0) + Math.max(0, ing.qty));
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

  return { accepted, violations };
}
