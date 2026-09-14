/**
 * What meals a plan should contain.
 *
 * Kept apart from planning.ts, which imports the Supabase client: this is
 * arithmetic over a clock and a list of preferences, and it should be testable
 * without a React Native runtime -- the same reason budget.ts sits outside the
 * Edge Function that calls it.
 */

import type { MealTimes } from './types';

/** One meal the plan should contain: which day of it, and which meal of that
 *  day. The whole shape of a plan is a list of these. */
export type PlanSlotRequest = { day_offset: number; category: string };

/**
 * The meals a plan should contain.
 *
 * Built here rather than guessed at by the generator, which used to assume
 * three meals a day for everybody and a plan starting today starting at
 * breakfast -- so a day plan made at seven in the evening scheduled breakfast
 * for eight that morning, eight hours in the past.
 *
 * Three things decide the shape: which meals this household plans at all,
 * how many days, and -- on the first day only -- what time it already is.
 */
export function planShape(options: {
  days: number;
  meals: string[];
  mealTimes: MealTimes;
  /** True when day 0 is today, which is the only day the clock matters on. */
  startsToday: boolean;
  /** Skip everything before this meal on the first day. Overrides the clock,
   *  for somebody who wants to start at dinner regardless. */
  firstMeal?: string | null;
  /** Local minutes past midnight. Injected so this is testable. */
  nowMinutes?: number;
}): PlanSlotRequest[] {
  const order = ['breakfast', 'lunch', 'snack', 'dinner'];
  const wanted = order.filter((m) => options.meals.includes(m));
  const now = options.nowMinutes ?? new Date().getHours() * 60 + new Date().getMinutes();

  const shape: PlanSlotRequest[] = [];
  for (let day = 0; day < options.days; day++) {
    for (const category of wanted) {
      if (day === 0) {
        if (options.firstMeal) {
          // An explicit choice wins over the clock: somebody may want to start
          // at dinner on a day whose lunch has not happened yet.
          if (order.indexOf(category) < order.indexOf(options.firstMeal)) continue;
        } else if (options.startsToday) {
          const at = options.mealTimes[category as keyof MealTimes];
          if (typeof at === 'number' && at <= now) continue;
        }
      }
      shape.push({ day_offset: day, category });
    }
  }
  return shape;
}

/** The meals of today that have not happened yet, for the "start from" picker.
 *  Empty when the day is over, which is itself the answer. */
export function mealsLeftToday(meals: string[], mealTimes: MealTimes, nowMinutes?: number): string[] {
  const now = nowMinutes ?? new Date().getHours() * 60 + new Date().getMinutes();
  return ['breakfast', 'lunch', 'snack', 'dinner']
    .filter((m) => meals.includes(m))
    .filter((m) => {
      const at = mealTimes[m as keyof MealTimes];
      return typeof at === 'number' && at > now;
    });
}

