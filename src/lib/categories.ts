import type { StoragePlace } from './types';

/**
 * Categories group the inventory list. Deliberately short: a list with
 * twenty headers is a list nobody scrolls. "Other" is the escape hatch and
 * always sorts last.
 */

export const CATEGORIES = [
  'Produce',
  'Meat & Fish',
  'Dairy & Eggs',
  'Bakery',
  'Grains & Pasta',
  'Canned & Jarred',
  'Frozen',
  'Condiments & Spices',
  'Snacks',
  'Drinks',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Days a category keeps in each place. Mirrors shelf_life_days() in SQL, which
 * is the authority -- this copy exists so a form can pre-fill an expiry date
 * without a round trip, and the two must not drift.
 *
 * The value under each category's natural storage is what Stockpot used before
 * shelf life knew about shelves, so nothing already on record shifted.
 */
export const SHELF_LIFE: Record<Category, Record<StoragePlace, number>> = {
  Produce: { pantry: 4, fridge: 7, freezer: 240 },
  'Meat & Fish': { pantry: 1, fridge: 3, freezer: 180 },
  'Dairy & Eggs': { pantry: 2, fridge: 10, freezer: 90 },
  Bakery: { pantry: 4, fridge: 10, freezer: 90 },
  'Grains & Pasta': { pantry: 365, fridge: 365, freezer: 540 },
  'Canned & Jarred': { pantry: 730, fridge: 730, freezer: 730 },
  // Frozen food out of the freezer is a today problem, not a date problem.
  Frozen: { pantry: 1, fridge: 2, freezer: 120 },
  'Condiments & Spices': { pantry: 365, fridge: 540, freezer: 540 },
  Snacks: { pantry: 90, fridge: 120, freezer: 180 },
  Drinks: { pantry: 180, fridge: 240, freezer: 365 },
  Other: { pantry: 30, fridge: 45, freezer: 180 },
};

/** Where a category normally lives, so a new product starts on the right
 *  shelf rather than defaulting everything to the cupboard. */
export const NATURAL_STORAGE: Record<Category, StoragePlace> = {
  Produce: 'fridge',
  'Meat & Fish': 'fridge',
  'Dairy & Eggs': 'fridge',
  Bakery: 'pantry',
  'Grains & Pasta': 'pantry',
  'Canned & Jarred': 'pantry',
  Frozen: 'freezer',
  'Condiments & Spices': 'pantry',
  Snacks: 'pantry',
  Drinks: 'pantry',
  Other: 'pantry',
};

export function shelfLife(category: string, storage: StoragePlace): number {
  return (SHELF_LIFE[category as Category] ?? SHELF_LIFE.Other)[storage];
}

/**
 * A product's own useful life, translated to another shelf. Mirrors
 * useful_life_days() in SQL.
 *
 * On its own shelf the stored number is returned untouched -- a life somebody
 * typed in is never quietly rewritten. A base of zero means "use it today" and
 * stays zero; anything else keeps at least a day, since rounding a short life
 * down to nothing would mark fresh stock as already gone.
 */
export function usefulLifeFor(
  category: string,
  baseDays: number,
  usual: StoragePlace,
  storage: StoragePlace
): number {
  if (!Number.isFinite(baseDays) || baseDays <= 0) return Math.max(0, baseDays || 0);
  if (storage === usual) return baseDays;
  const scaled = Math.round((baseDays * shelfLife(category, storage)) / Math.max(shelfLife(category, usual), 1));
  return Math.min(3650, Math.max(1, scaled));
}

export function categoryRank(category: string): number {
  const index = CATEGORIES.indexOf(category as Category);
  return index === -1 ? CATEGORIES.length : index;
}

/**
 * A glyph per category. Products have no photographs, so this is what gives a
 * long list something to scan by: shape and colour before the name is read.
 */
export const CATEGORY_ICONS: Record<Category, string> = {
  Produce: 'leaf',
  'Meat & Fish': 'fish',
  'Dairy & Eggs': 'egg',
  Bakery: 'pizza',
  'Grains & Pasta': 'nutrition',
  'Canned & Jarred': 'file-tray-full',
  Frozen: 'snow',
  'Condiments & Spices': 'flask',
  Snacks: 'ice-cream',
  Drinks: 'wine',
  Other: 'cube',
};

export function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category as Category] ?? 'cube';
}
