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

/** Sensible starting shelf life per category, in days, used to pre-fill
 *  expiry so no product is ever saved without a date. */
export const DEFAULT_USEFUL_LIFE: Record<Category, number> = {
  Produce: 7,
  'Meat & Fish': 3,
  'Dairy & Eggs': 10,
  Bakery: 4,
  'Grains & Pasta': 365,
  'Canned & Jarred': 730,
  Frozen: 120,
  'Condiments & Spices': 365,
  Snacks: 90,
  Drinks: 180,
  Other: 30,
};

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
