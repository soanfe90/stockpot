/**
 * Exercises the plan shape -- which meals a generated plan should contain.
 *
 * Worth testing away from the app because it is where three separate answers
 * meet: which meals a household plans at all, how many days, and what time it
 * already is. Getting the third wrong is what scheduled a breakfast for eight
 * hours in the past.
 *
 *   node --experimental-strip-types --test src/lib/__tests__/plan-shape.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mealsLeftToday, planShape } from '../plan-shape.ts';
import { DEFAULT_MEAL_TIMES } from '../types.ts';

const THREE = ['breakfast', 'lunch', 'dinner'];
const times = DEFAULT_MEAL_TIMES; // 08:00, 13:00, 20:00, snack 17:00

const at = (hours: number) => hours * 60;

test('a plan starting tomorrow is a full day, whatever time it is now', () => {
  const shape = planShape({ days: 1, meals: THREE, mealTimes: times, startsToday: false, nowMinutes: at(19) });
  assert.deepEqual(shape.map((s) => s.category), THREE);
});

test('a plan starting today leaves out meals whose time has gone', () => {
  // Seven in the evening: breakfast and lunch already happened.
  const shape = planShape({ days: 1, meals: THREE, mealTimes: times, startsToday: true, nowMinutes: at(19) });
  assert.deepEqual(shape, [{ day_offset: 0, category: 'dinner' }]);
});

test('early enough in the day, nothing is lost', () => {
  const shape = planShape({ days: 1, meals: THREE, mealTimes: times, startsToday: true, nowMinutes: at(6) });
  assert.equal(shape.length, 3);
});

test('a day with nothing left returns nothing rather than yesterday', () => {
  const shape = planShape({ days: 1, meals: THREE, mealTimes: times, startsToday: true, nowMinutes: at(23) });
  assert.deepEqual(shape, []);
});

test('only the first day is measured against the clock', () => {
  const shape = planShape({ days: 3, meals: THREE, mealTimes: times, startsToday: true, nowMinutes: at(19) });
  // Today's dinner, then two whole days.
  assert.equal(shape.length, 1 + 3 + 3);
  assert.equal(shape.filter((s) => s.day_offset === 0).length, 1);
  assert.equal(shape.filter((s) => s.day_offset === 2).length, 3);
});

test('a household that eats twice a day gets two meals a day', () => {
  const shape = planShape({
    days: 2,
    meals: ['lunch', 'dinner'],
    mealTimes: times,
    startsToday: false,
  });
  assert.equal(shape.length, 4);
  assert.ok(!shape.some((s) => s.category === 'breakfast'));
});

test('snacks appear only when asked for, and in their place in the day', () => {
  const withSnack = planShape({
    days: 1,
    meals: ['breakfast', 'lunch', 'snack', 'dinner'],
    mealTimes: times,
    startsToday: false,
  });
  assert.deepEqual(withSnack.map((s) => s.category), ['breakfast', 'lunch', 'snack', 'dinner']);

  const without = planShape({ days: 1, meals: THREE, mealTimes: times, startsToday: false });
  assert.ok(!without.some((s) => s.category === 'snack'));
});

test('an explicit first meal overrides the clock in both directions', () => {
  // Nine in the morning: lunch and dinner are still ahead, but they want to
  // start at dinner.
  const later = planShape({
    days: 1,
    meals: THREE,
    mealTimes: times,
    startsToday: true,
    firstMeal: 'dinner',
    nowMinutes: at(9),
  });
  assert.deepEqual(later, [{ day_offset: 0, category: 'dinner' }]);

  // And asking for lunch at seven in the evening is honoured rather than
  // silently corrected: the choice is the user's, not the clock's.
  const earlier = planShape({
    days: 1,
    meals: THREE,
    mealTimes: times,
    startsToday: true,
    firstMeal: 'lunch',
    nowMinutes: at(19),
  });
  assert.deepEqual(earlier.map((s) => s.category), ['lunch', 'dinner']);
});

test('what is left today is what the picker offers', () => {
  assert.deepEqual(mealsLeftToday(THREE, times, at(6)), THREE);
  assert.deepEqual(mealsLeftToday(THREE, times, at(9)), ['lunch', 'dinner']);
  assert.deepEqual(mealsLeftToday(THREE, times, at(23)), []);
});
