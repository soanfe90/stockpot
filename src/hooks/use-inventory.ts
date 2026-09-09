import { useCallback, useEffect, useMemo, useState } from 'react';

import { stockState, urgencyRank, type StockState } from '@/lib/expiry';
import { errorMessage, supabase } from '@/lib/supabase';
import type { Product, ProductStock, StockedProduct } from '@/lib/types';

export type InventoryData = {
  products: StockedProduct[];
  /** product_id -> receipt strings that resolve to it, so search finds a
   *  product typed the way the till printed it. */
  aliases: Record<string, string[]>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useInventory(householdId: string | null): InventoryData {
  const [products, setProducts] = useState<StockedProduct[]>([]);
  const [aliases, setAliases] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!householdId) {
      setProducts([]);
      setAliases({});
      setLoading(false);
      return;
    }
    setError(null);
    try {
      // The stock view has no foreign key for PostgREST to embed through, so
      // catalog and rolled-up stock are fetched together and merged here.
      const [catalog, stock, aliasRows] = await Promise.all([
        supabase.from('product').select('*').eq('household_id', householdId),
        supabase.from('product_stock').select('*').eq('household_id', householdId),
        supabase.from('product_alias').select('product_id, raw_text').eq('household_id', householdId),
      ]);

      if (catalog.error) throw catalog.error;
      if (stock.error) throw stock.error;
      if (aliasRows.error) throw aliasRows.error;

      const byProduct = new Map<string, ProductStock>();
      for (const row of (stock.data ?? []) as ProductStock[]) {
        byProduct.set(row.product_id, row);
      }

      const merged: StockedProduct[] = ((catalog.data ?? []) as Product[]).map((product) => {
        const s = byProduct.get(product.id);
        return {
          ...product,
          qty_total: Number(s?.qty_total ?? 0),
          qty_reserved: Number(s?.qty_reserved ?? 0),
          next_expiry: s?.next_expiry ?? null,
          lot_count: Number(s?.lot_count ?? 0),
        };
      });

      const aliasMap: Record<string, string[]> = {};
      for (const row of (aliasRows.data ?? []) as { product_id: string; raw_text: string }[]) {
        (aliasMap[row.product_id] ??= []).push(row.raw_text);
      }

      setProducts(merged);
      setAliases(aliasMap);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Two people, one pantry: another member's edits land here without a pull.
  useEffect(() => {
    if (!householdId) return;
    const channel = supabase
      .channel(`inventory:${householdId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inventory_lot', filter: `household_id=eq.${householdId}` },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product', filter: `household_id=eq.${householdId}` },
        () => void refresh()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, refresh]);

  return { products, aliases, loading, error, refresh };
}

/* ------------------------------------------------------------ filtering -- */

export type StateFilter = 'in_stock' | 'out_of_stock' | 'expiring' | 'expired';

export type Filters = {
  query: string;
  categories: string[];
  states: StateFilter[];
};

export const EMPTY_FILTERS: Filters = { query: '', categories: [], states: [] };

const STATE_MATCHERS: Record<StateFilter, (state: StockState) => boolean> = {
  in_stock: (s) => s !== 'out',
  out_of_stock: (s) => s === 'out',
  expiring: (s) => s === 'urgent' || s === 'soon',
  expired: (s) => s === 'expired',
};

export function applyFilters(
  products: StockedProduct[],
  aliases: Record<string, string[]>,
  filters: Filters
): StockedProduct[] {
  const needle = filters.query.trim().toLowerCase();

  return products
    .filter((product) => {
      if (filters.categories.length && !filters.categories.includes(product.category)) return false;

      if (filters.states.length) {
        const state = stockState(product.qty_total, product.next_expiry);
        // Filters within the group are an OR: "expired or out of stock".
        if (!filters.states.some((f) => STATE_MATCHERS[f](state))) return false;
      }

      if (needle) {
        const haystack = [product.name, product.category, ...(aliases[product.id] ?? [])]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const rank =
        urgencyRank(stockState(a.qty_total, a.next_expiry), a.next_expiry) -
        urgencyRank(stockState(b.qty_total, b.next_expiry), b.next_expiry);
      return rank !== 0 ? rank : a.name.localeCompare(b.name);
    });
}

/* -------------------------------------------------------------- summary -- */

export type StockSummary = {
  total: number;
  inStock: number;
  outOfStock: number;
  expiringSoon: number;
  expiringUrgent: number;
  expired: number;
};

export function useStockSummary(products: StockedProduct[]): StockSummary {
  return useMemo(() => {
    const summary: StockSummary = {
      total: products.length,
      inStock: 0,
      outOfStock: 0,
      expiringSoon: 0,
      expiringUrgent: 0,
      expired: 0,
    };
    for (const product of products) {
      switch (stockState(product.qty_total, product.next_expiry)) {
        case 'out':
          summary.outOfStock += 1;
          break;
        case 'expired':
          summary.expired += 1;
          break;
        case 'urgent':
          summary.expiringUrgent += 1;
          summary.inStock += 1;
          break;
        case 'soon':
          summary.expiringSoon += 1;
          summary.inStock += 1;
          break;
        case 'fresh':
          summary.inStock += 1;
          break;
      }
    }
    return summary;
  }, [products]);
}
