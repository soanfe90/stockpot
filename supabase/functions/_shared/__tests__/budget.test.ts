/**
 * Exercises the plan enforcer -- the guard that decides whether a generated
 * plan is honest about what the pantry holds, and whether what it asks the
 * household to buy is reasonable.
 *
 *   node --experimental-strip-types --test supabase/functions/_shared/__tests__/budget.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enforcePlan, type PlanLimits, type PlanSlot } from '../budget.ts';

const pantry = [
  { product_id: 'chicken', name: 'Pollo', available: 1000 },
  { product_id: 'rice', name: 'Arroz', available: 500 },
];

/** A week's worth of room: two days off the shelf, two trips, ten new things. */
const limits: PlanLimits = { pantryOnlyDays: 2, maxShoppingDays: 2, maxNewProducts: 10 };
/** What a single-day plan gets: everything from the shelf, nothing bought. */
const closed: PlanLimits = { pantryOnlyDays: 7, maxShoppingDays: 0, maxNewProducts: 0 };

function slot(name: string, dayOffset: number, ingredients: PlanSlot['ingredients']): PlanSlot {
  return { name, day_offset: dayOffset, ingredients };
}

const from = (id: string, qty: number, name = id, optional = false) =>
  ({ product_id: id, name, qty, optional, source: 'pantry' }) as const;
const buy = (name: string, qty: number) =>
  ({ product_id: null, name, qty, optional: false, source: 'buy' }) as const;
const staple = (name: string, qty: number) =>
  ({ product_id: null, name, qty, optional: false, source: 'staple' }) as const;

/* ------------------------------------------------------- the pantry budget -- */

test('a plan inside the pantry passes untouched, and buys nothing', () => {
  const { accepted, violations, purchases } = enforcePlan(
    [slot('A', 0, [from('chicken', 400), from('rice', 200)]), slot('B', 1, [from('chicken', 600)])],
    pantry,
    limits
  );
  assert.equal(accepted.length, 2);
  assert.deepEqual(violations, []);
  assert.deepEqual(purchases, []);
});

test('the whole plan is budgeted together, not meal by meal', () => {
  // Each meal fits on its own; together they want 1200 g of 1000 g.
  const { accepted, violations } = enforcePlan(
    [slot('A', 0, [from('chicken', 700)]), slot('B', 1, [from('chicken', 500)])],
    pantry,
    limits
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].name, 'A');
  assert.match(violations.join('\n'), /only 300 is left unspent/);
});

test('a product that is not in the pantry cannot be claimed as pantry stock', () => {
  const { accepted, violations } = enforcePlan(
    [slot('A', 0, [{ product_id: 'saffron', name: 'Azafrán', qty: 1, optional: false, source: 'pantry' }])],
    pantry,
    limits
  );
  assert.equal(accepted.length, 0);
  assert.match(violations.join('\n'), /not in the pantry/);
});

test('an ingredient with no amount is refused, optional ones included', () => {
  const zero = enforcePlan([slot('A', 0, [from('rice', 0)])], pantry, limits);
  assert.equal(zero.accepted.length, 0);
  assert.match(zero.violations.join('\n'), /no amount/);

  // "Optional" means the cook may leave it out, not that it has no size.
  const optional = enforcePlan(
    [slot('A', 0, [{ product_id: 'rice', name: 'Arroz', qty: 0, optional: true, source: 'pantry' }])],
    pantry,
    limits
  );
  assert.equal(optional.accepted.length, 0);
});

test('only the whitelist may go untracked', () => {
  const ok = enforcePlan([slot('A', 0, [from('rice', 200), staple('salt', 5)])], pantry, limits);
  assert.equal(ok.accepted.length, 1);

  const invented = enforcePlan([slot('A', 0, [staple('Saffron', 1)])], pantry, limits);
  assert.equal(invented.accepted.length, 0);
  assert.match(invented.violations.join('\n'), /not one/);
});

/* --------------------------------------------------------- reaching past it -- */

test('later days may need shopping, and the purchase carries its deadline', () => {
  const { accepted, purchases } = enforcePlan(
    [slot('A', 0, [from('rice', 200)]), slot('B', 3, [buy('Lentejas', 300)])],
    pantry,
    limits
  );
  assert.equal(accepted.length, 2);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].name, 'Lentejas');
  assert.equal(purchases[0].firstNeededDay, 3);
});

test('the first days come entirely from the pantry', () => {
  // Nobody should have to shop before they can cook tonight.
  const { accepted, violations } = enforcePlan(
    [slot('A', 0, [buy('Lentejas', 300)]), slot('B', 4, [buy('Lentejas', 300)])],
    pantry,
    limits
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].name, 'B');
  assert.match(violations.join('\n'), /entirely from the pantry/);
});

test('a single-day plan buys nothing at all', () => {
  const { accepted, violations } = enforcePlan([slot('A', 0, [buy('Lentejas', 300)])], pantry, closed);
  assert.equal(accepted.length, 0);
  assert.match(violations.join('\n'), /entirely from the pantry/);
});

test('nothing is bought that the house already has enough of', () => {
  const { accepted, violations } = enforcePlan([slot('A', 3, [buy('Arroz', 200)])], pantry, limits);
  assert.equal(accepted.length, 0);
  assert.match(violations.join('\n'), /already 500 of it/);
});

test('a purchase used by several meals is one purchase, dated by the first', () => {
  const { purchases } = enforcePlan(
    [slot('A', 5, [buy('Lentejas', 300)]), slot('B', 3, [buy('lentejas', 200)])],
    pantry,
    limits
  );
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].qty, 500);
  assert.equal(purchases[0].firstNeededDay, 3);
});

/* --------------------------------------------------- keeping out of the shop -- */

test('a plan needing shopping on too many days is trimmed back', () => {
  const { accepted, purchases, violations } = enforcePlan(
    [
      slot('A', 2, [buy('Lentejas', 100)]),
      slot('B', 3, [buy('Garbanzos', 100)]),
      slot('C', 4, [buy('Alubias', 100)]),
      slot('D', 5, [buy('Quinoa', 100)]),
    ],
    pantry,
    { pantryOnlyDays: 2, maxShoppingDays: 2, maxNewProducts: 10 }
  );
  assert.ok(new Set(purchases.map((p) => p.firstNeededDay)).size <= 2);
  // Trimmed from the end: the early days are the ones actually cooked first.
  assert.deepEqual(accepted.map((s) => s.name), ['A', 'B']);
  assert.match(violations.join('\n'), /separate days/);
});

test('too long a shopping list is trimmed back too', () => {
  const { purchases, violations } = enforcePlan(
    [
      slot('A', 3, [buy('Lentejas', 100), buy('Garbanzos', 100)]),
      slot('B', 3, [buy('Alubias', 100)]),
    ],
    pantry,
    { pantryOnlyDays: 2, maxShoppingDays: 2, maxNewProducts: 2 }
  );
  assert.ok(purchases.length <= 2);
  assert.match(violations.join('\n'), /different things/);
});

test('reusing one bought item across the week costs nothing extra', () => {
  // The shape the rules are meant to encourage: buy once, cook with it twice.
  const { accepted, purchases, violations } = enforcePlan(
    [
      slot('A', 0, [from('rice', 200)]),
      slot('B', 1, [from('chicken', 300)]),
      slot('C', 2, [buy('Lentejas', 200)]),
      slot('D', 4, [buy('Lentejas', 200)]),
      slot('E', 5, [buy('Lentejas', 100)]),
    ],
    pantry,
    { pantryOnlyDays: 2, maxShoppingDays: 1, maxNewProducts: 1 }
  );
  assert.equal(accepted.length, 5);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].qty, 500);
  assert.deepEqual(violations, []);
});
