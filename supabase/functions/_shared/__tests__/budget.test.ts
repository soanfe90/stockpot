/**
 * Exercises the plan budget enforcer -- the guard that stops a generated plan
 * from calling for food the household does not have.
 *
 *   node --experimental-strip-types --test supabase/functions/_shared/__tests__/budget.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { enforceBudget, type PlanSlot } from '../budget.ts';

const pantry = [
  { product_id: 'chicken', name: 'Pollo', available: 1000 },
  { product_id: 'rice', name: 'Arroz', available: 500 },
];

function slot(name: string, dayOffset: number, ingredients: PlanSlot['ingredients']): PlanSlot {
  return { name, day_offset: dayOffset, ingredients };
}

const use = (id: string | null, qty: number, name = id ?? '', optional = false) => ({
  product_id: id,
  name,
  qty,
  optional,
});

test('a plan inside the pantry passes untouched', () => {
  const { accepted, violations } = enforceBudget(
    [slot('A', 0, [use('chicken', 400), use('rice', 200)]), slot('B', 1, [use('chicken', 600)])],
    pantry
  );
  assert.equal(accepted.length, 2);
  assert.deepEqual(violations, []);
});

test('the whole plan is budgeted together, not meal by meal', () => {
  // Each meal fits on its own; together they want 1200 g of 1000 g.
  const { accepted, violations } = enforceBudget(
    [slot('A', 0, [use('chicken', 600)]), slot('B', 1, [use('chicken', 600)])],
    pantry
  );
  assert.equal(accepted.length, 1, 'the second meal must be dropped');
  assert.equal(accepted[0].name, 'A');
  assert.match(violations[0], /wants 600 of Pollo, but only 400 is left/);
});

test('earlier days win, so what survives is a real prefix', () => {
  const { accepted } = enforceBudget(
    [slot('Later', 3, [use('chicken', 800)]), slot('Earlier', 0, [use('chicken', 800)])],
    pantry
  );
  assert.deepEqual(accepted.map((s) => s.name), ['Earlier']);
});

test('an invented ingredient drops the meal', () => {
  const { accepted, violations } = enforceBudget(
    [slot('A', 0, [use('chicken', 100), use(null, 50, 'saffron')])],
    pantry
  );
  assert.equal(accepted.length, 0);
  assert.match(violations[0], /uses "saffron", which is not in the pantry/);
});

test('whitelisted staples are allowed untracked, in either language', () => {
  const { accepted, violations } = enforceBudget(
    [slot('A', 0, [use('rice', 100), use(null, 5, 'Salt'), use(null, 10, 'aceite')])],
    pantry
  );
  assert.equal(accepted.length, 1);
  assert.deepEqual(violations, []);
});

test('a product outside the pantry list is refused even with an id', () => {
  const { accepted, violations } = enforceBudget([slot('A', 0, [use('caviar', 10)])], pantry);
  assert.equal(accepted.length, 0);
  assert.match(violations[0], /references a product that is not in the pantry/);
});

test('optional ingredients do not consume budget', () => {
  // 1000 g of chicken required, plus 900 g listed as optional garnish.
  const { accepted, violations } = enforceBudget(
    [slot('A', 0, [use('chicken', 1000), use('chicken', 900, 'Pollo', true)])],
    pantry
  );
  assert.equal(accepted.length, 1);
  assert.deepEqual(violations, []);
});

test('spending exactly the pantry is allowed; a gram more is not', () => {
  assert.equal(enforceBudget([slot('A', 0, [use('rice', 500)])], pantry).accepted.length, 1);
  assert.equal(enforceBudget([slot('A', 0, [use('rice', 500.001)])], pantry).accepted.length, 0);
});

test('repeated use of one product within a meal is summed, not taken separately', () => {
  const { accepted, violations } = enforceBudget(
    [slot('A', 0, [use('rice', 300), use('rice', 300)])],
    pantry
  );
  assert.equal(accepted.length, 0, '600 g of rice from a 500 g pantry must be caught');
  assert.match(violations[0], /wants 600 of Arroz/);
});

test('an empty plan yields nothing and complains about nothing', () => {
  const { accepted, violations } = enforceBudget([], pantry);
  assert.deepEqual(accepted, []);
  assert.deepEqual(violations, []);
});
