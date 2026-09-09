import { useCallback, useEffect, useMemo, useState } from 'react';

import { categoryRank } from '@/lib/categories';
import { errorMessage, supabase } from '@/lib/supabase';
import type { ItemSource, PurchaseResult, ShoppingItem, ShoppingList } from '@/lib/types';
import { toBase, type BaseUnit } from '@/lib/units';

export function useShoppingList(householdId: string | null) {
  const [list, setList] = useState<ShoppingList | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Recomputes suggestions, then reads the list back. Refresh is safe to run
   *  on every open: it never touches a row someone has edited or ticked. */
  const refresh = useCallback(async () => {
    if (!householdId) {
      setList(null);
      setItems([]);
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const { data: opened, error: rpcError } = await supabase.rpc('refresh_shopping_list', {
        p_household_id: householdId,
      });
      if (rpcError) throw rpcError;

      const current = (Array.isArray(opened) ? opened[0] : opened) as ShoppingList;
      const { data, error: itemError } = await supabase
        .from('shopping_item')
        .select('*')
        .eq('list_id', current.id)
        .order('position');
      if (itemError) throw itemError;

      setList(current);
      setItems((data ?? []) as ShoppingItem[]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Two people in two aisles must not buy the same thing twice.
  useEffect(() => {
    if (!list) return;
    const channel = supabase
      .channel(`shopping:${list.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_item', filter: `list_id=eq.${list.id}` },
        () => void reload(list.id, setItems)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [list]);

  /** Ticking or editing pins the row, so the next refresh leaves it alone. */
  const patch = useCallback(async (item: ShoppingItem, changes: Partial<ShoppingItem>) => {
    const next = { ...changes, pinned: true };
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...next } : i)));
    const { error: updateError } = await supabase.from('shopping_item').update(next).eq('id', item.id);
    if (updateError) setError(errorMessage(updateError));
  }, []);

  const remove = useCallback(async (item: ShoppingItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    const { error: deleteError } = await supabase.from('shopping_item').delete().eq('id', item.id);
    if (deleteError) setError(errorMessage(deleteError));
  }, []);

  const addManual = useCallback(
    async (name: string, qty: number, displayUnit: string, baseUnit: BaseUnit) => {
      if (!list || !householdId) return;
      const { error: insertError } = await supabase.from('shopping_item').insert({
        list_id: list.id,
        household_id: householdId,
        name: name.trim(),
        qty: toBase(qty, baseUnit, displayUnit),
        display_unit: displayUnit,
        base_unit: baseUnit,
        source: 'manual' as ItemSource,
        pinned: true,
      });
      if (insertError) setError(errorMessage(insertError));
      else await reload(list.id, setItems);
    },
    [list, householdId]
  );

  const close = useCallback(
    async (store: string | null, total: number | null): Promise<PurchaseResult> => {
      if (!list) throw new Error('No open list.');
      const { data, error: rpcError } = await supabase.rpc('close_purchase', {
        p_list_id: list.id,
        p_store: store,
        p_total: total,
      });
      if (rpcError) throw rpcError;
      await refresh();
      return data as PurchaseResult;
    },
    [list, refresh]
  );

  /** Aisle order: grouped by category, unticked first inside each group. */
  const sections = useMemo(() => {
    const groups = new Map<string, ShoppingItem[]>();
    for (const item of items) {
      const list = groups.get(item.category) ?? [];
      list.push(item);
      groups.set(item.category, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
      .map(([title, data]) => ({
        title,
        data: data.sort(
          (a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name)
        ),
      }));
  }, [items]);

  const checked = items.filter((i) => i.checked);

  return {
    list,
    items,
    sections,
    checked,
    remaining: items.length - checked.length,
    loading,
    error,
    refresh,
    patch,
    remove,
    addManual,
    close,
  };
}

async function reload(listId: string, set: (items: ShoppingItem[]) => void) {
  const { data } = await supabase.from('shopping_item').select('*').eq('list_id', listId).order('position');
  set((data ?? []) as ShoppingItem[]);
}
