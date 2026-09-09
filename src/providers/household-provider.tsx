import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import type { Household, MemberRole } from '@/lib/types';

import { useSession } from './session-provider';

type HouseholdContextValue = {
  household: Household | null;
  role: MemberRole | null;
  loading: boolean;
  refresh: () => Promise<void>;
  createHousehold: (name: string, size: number) => Promise<void>;
  joinHousehold: (inviteCode: string) => Promise<void>;
};

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [household, setHousehold] = useState<Household | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setHousehold(null);
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    // A user can belong to several households; the oldest membership wins
    // until there is a switcher to choose between them.
    const { data, error } = await supabase
      .from('household_member')
      .select('role, joined_at, household:household_id (*)')
      .eq('user_id', userId)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      setHousehold(null);
      setRole(null);
    } else if (data) {
      setHousehold((data.household as unknown as Household) ?? null);
      setRole((data.role as MemberRole) ?? null);
    } else {
      setHousehold(null);
      setRole(null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createHousehold = useCallback(
    async (name: string, size: number) => {
      const { error } = await supabase.rpc('create_household', { p_name: name, p_size: size });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const joinHousehold = useCallback(
    async (inviteCode: string) => {
      const { error } = await supabase.rpc('join_household', { p_invite_code: inviteCode });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const value = useMemo<HouseholdContextValue>(
    () => ({ household, role, loading, refresh, createHousehold, joinHousehold }),
    [household, role, loading, refresh, createHousehold, joinHousehold]
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold must be used inside <HouseholdProvider>');
  return ctx;
}
