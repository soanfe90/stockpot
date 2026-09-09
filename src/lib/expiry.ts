/**
 * The expiry engine.
 *
 * Stockpot's organising idea is time, not count: every list in the app sorts
 * by days-to-expiry before anything else. These five states and their two
 * thresholds are the only place that judgement lives.
 */

import type { Tokens } from '@/theme/tokens';

export type StockState = 'out' | 'expired' | 'urgent' | 'soon' | 'fresh';

export const URGENT_DAYS = 3;
export const SOON_DAYS = 7;

/** Whole days from today to the given date. Negative once it has passed. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function stockState(qtyTotal: number, nextExpiry: string | null): StockState {
  if (qtyTotal <= 0) return 'out';
  const days = daysUntil(nextExpiry);
  // No date means nothing is known, not that the item is fine -- but with
  // expiry inferred from useful life on every write, this should be rare.
  if (days === null) return 'fresh';
  if (days < 0) return 'expired';
  if (days <= URGENT_DAYS) return 'urgent';
  if (days <= SOON_DAYS) return 'soon';
  return 'fresh';
}

export function stateLabel(state: StockState, nextExpiry: string | null): string {
  const days = daysUntil(nextExpiry);
  switch (state) {
    case 'out':
      return 'Out of stock';
    case 'expired':
      return days === null ? 'Expired' : days === -1 ? 'Expired yesterday' : `Expired ${Math.abs(days)} days ago`;
    case 'urgent':
      return days === 0 ? 'Today' : days === 1 ? '1 day left' : `${days} days left`;
    case 'soon':
      return `${days} days left`;
    case 'fresh':
      return 'In stock';
  }
}

export function stateColors(t: Tokens, state: StockState): { fg: string; bg: string } {
  switch (state) {
    case 'out':
    case 'expired':
      return { fg: t.gone, bg: t.goneWash };
    case 'urgent':
      return { fg: t.urgent, bg: t.urgentWash };
    case 'soon':
      return { fg: t.soon, bg: t.soonWash };
    case 'fresh':
      return { fg: t.fresh, bg: t.freshWash };
  }
}

/** Sort key: the most urgent thing in the house comes first. */
export function urgencyRank(state: StockState, nextExpiry: string | null): number {
  const order: Record<StockState, number> = {
    expired: 0,
    urgent: 1,
    out: 2,
    soon: 3,
    fresh: 4,
  };
  return order[state] * 100_000 + (daysUntil(nextExpiry) ?? 9_999);
}

/** ISO date (yyyy-mm-dd) N days from today, for defaulting expiry fields. */
export function isoDateIn(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(date: string | null): string {
  if (!date) return '--';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
