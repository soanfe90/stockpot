/**
 * Unit handling.
 *
 * The ledger stores every quantity in the product's base unit -- grams,
 * millilitres, or countable units -- and converts only for display. This is
 * the single rule that keeps "two chicken breasts", "1.8 kg" and a till line
 * reading PECHUGA 0,842 from drifting apart.
 */

export type BaseUnit = 'g' | 'ml' | 'unit';

export type DisplayUnit = {
  /** What the user sees and types. */
  key: string;
  label: string;
  /** How many base units one display unit is worth. */
  factor: number;
  /** Decimal places to show. */
  precision: number;
};

export const DISPLAY_UNITS: Record<BaseUnit, DisplayUnit[]> = {
  g: [
    { key: 'g', label: 'grams', factor: 1, precision: 0 },
    { key: 'kg', label: 'kilograms', factor: 1000, precision: 2 },
  ],
  ml: [
    { key: 'ml', label: 'millilitres', factor: 1, precision: 0 },
    { key: 'L', label: 'litres', factor: 1000, precision: 2 },
  ],
  unit: [
    { key: 'ud', label: 'units', factor: 1, precision: 0 },
    { key: 'pack', label: 'packs', factor: 1, precision: 0 },
  ],
};

export const BASE_UNIT_LABELS: Record<BaseUnit, string> = {
  g: 'Weight',
  ml: 'Volume',
  unit: 'Count',
};

export function displayUnit(base: BaseUnit, key: string): DisplayUnit {
  const found = DISPLAY_UNITS[base].find((u) => u.key === key);
  // An unrecognised display unit falls back to the base unit rather than
  // throwing: a bad string should never hide a product from its owner.
  return found ?? DISPLAY_UNITS[base][0];
}

/** Display value -> base units, for writing to the ledger. */
export function toBase(value: number, base: BaseUnit, key: string): number {
  return round(value * displayUnit(base, key).factor, 3);
}

/** Base units -> display value, for rendering. */
export function fromBase(qty: number, base: BaseUnit, key: string): number {
  const unit = displayUnit(base, key);
  return round(qty / unit.factor, unit.precision);
}

/** "1.80 kg", "200 g", "12 ud" -- always in the product's chosen unit. */
export function formatQty(qty: number, base: BaseUnit, key: string): string {
  const unit = displayUnit(base, key);
  const value = qty / unit.factor;
  return `${value.toFixed(unit.precision)} ${unit.key}`;
}

/** Accepts both "1.8" and the comma decimals printed on Spanish receipts. */
export function parseQty(input: string): number | null {
  const cleaned = input.trim().replace(',', '.');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
