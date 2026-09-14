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

/** A household that shops on plan-days 2 and 5, with room for ten new things. */
const limits: PlanLimits = { shoppingDays: [2, 5], maxNewProducts: 10, pantryOnlyDays: 1 };
/** One that never shops: the plan comes entirely from what is already in. */
const closed: PlanLimits = { shoppingDays: [], maxNewProducts: 0, pantryOnlyDays: 1 };

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

test('later days may need shopping, and each purchase names the trip that covers it', () => {
  const { accepted, purchases } = enforcePlan(
    [slot('A', 0, [from('rice', 200)]), slot('B', 3, [buy('Lentejas', 300)])],
    pantry,
    limits
  );
  assert.equal(accepted.length, 2);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].name, 'Lentejas');
  assert.equal(purchases[0].firstNeededDay, 3);
  // Wanted on day 3, bought on the day-2 trip -- not the day-5 one.
  assert.equal(purchases[0].shopOnDay, 2);
});

test('today comes entirely from the pantry, whatever the shopping days say', () => {
  // Nobody should have to shop before they can cook tonight.
  const { accepted, violations } = enforcePlan(
    [slot('A', 0, [buy('Lentejas', 300)]), slot('B', 4, [buy('Lentejas', 300)])],
    pantry,
    { shoppingDays: [0, 2], maxNewProducts: 10, pantryOnlyDays: 1 }
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].name, 'B');
  assert.match(violations.join('\n'), /cook tonight/);
});

test('a household that never shops is planned from stock alone', () => {
  const { accepted, violations } = enforcePlan([slot('A', 3, [buy('Lentejas', 300)])], pantry, closed);
  assert.equal(accepted.length, 0);
  assert.match(violations.join('\n'), /does not plan around shopping/);
});

test('nothing may be needed before the household can get to a shop', () => {
  // They shop on day 5. A meal on day 3 cannot be built on something bought.
  const { accepted, violations } = enforcePlan(
    [slot('A', 3, [buy('Lentejas', 300)]), slot('B', 6, [buy('Lentejas', 300)])],
    pantry,
    { shoppingDays: [5], maxNewProducts: 10, pantryOnlyDays: 1 }
  );
  assert.deepEqual(accepted.map((s) => s.name), ['B']);
  assert.match(violations.join('\n'), /cannot get to a shop before then/);
});

test('one weekly shop and two shops a week do not give the same plan', () => {
  const meals = [
    slot('A', 0, [from('rice', 200)]),
    slot('B', 2, [buy('Lentejas', 200)]),
    slot('C', 6, [buy('Garbanzos', 200)]),
  ];
  const weekly = enforcePlan(meals, pantry, { shoppingDays: [5], maxNewProducts: 10, pantryOnlyDays: 1 });
  const twice = enforcePlan(meals, pantry, { shoppingDays: [1, 4], maxNewProducts: 10, pantryOnlyDays: 1 });

  // One shop on day 5 cannot supply a meal on day 2, so that meal goes and the
  // week is built from the shelf around it. Two shops carry both.
  assert.deepEqual(weekly.accepted.map((s) => s.name), ['A', 'C']);
  assert.deepEqual(weekly.purchases.map((p) => p.shopOnDay), [5]);
  assert.deepEqual(twice.accepted.map((s) => s.name), ['A', 'B', 'C']);
  assert.deepEqual(twice.purchases.map((p) => p.shopOnDay), [1, 4]);
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

test('too long a shopping list is trimmed back, from the end', () => {
  const { accepted, purchases, violations } = enforcePlan(
    [
      slot('A', 2, [buy('Lentejas', 100)]),
      slot('B', 3, [buy('Garbanzos', 100)]),
      slot('C', 4, [buy('Alubias', 100)]),
      slot('D', 5, [buy('Quinoa', 100)]),
    ],
    pantry,
    { shoppingDays: [2], maxNewProducts: 2, pantryOnlyDays: 1 }
  );
  assert.ok(purchases.length <= 2);
  // The early days are the ones actually cooked before anything changes.
  assert.deepEqual(accepted.map((s) => s.name), ['A', 'B']);
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
    { shoppingDays: [2], maxNewProducts: 1, pantryOnlyDays: 1 }
  );
  assert.equal(accepted.length, 5);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].qty, 500);
  assert.deepEqual(violations, []);
});

test('a household with nothing in yet can be planned entirely from the shop', () => {
  // The empty-pantry case: there is no shelf to fall back on, so the usual
  // "today comes from the pantry" rule would leave nothing to eat at all.
  const { accepted, purchases, violations } = enforcePlan(
    [slot('A', 0, [buy('Arroz', 300), buy('Pollo', 400)]), slot('B', 1, [buy('Arroz', 200)])],
    [],
    { shoppingDays: [0], maxNewProducts: 10, pantryOnlyDays: 0 }
  );
  assert.equal(accepted.length, 2);
  assert.deepEqual(violations, []);
  assert.deepEqual(purchases.map((p) => p.name).sort(), ['Arroz', 'Pollo']);
  // All of it hangs off the one trip they can make today.
  assert.ok(purchases.every((p) => p.shopOnDay === 0));
});
