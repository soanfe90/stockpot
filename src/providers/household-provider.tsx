import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';
import type { Household, MealTimes, MemberRole, UserProfile } from '@/lib/types';

import { useSession } from './session-provider';

type Preferences = {
  diets: string[];
  cuisines: string[];
  goals: string[];
  /** Omitted means "leave them as they are" -- save_preferences reads null the
   *  same way, so editing diets alone never resets someone's schedule. */
  mealTimes?: MealTimes;
};

type HouseholdContextValue = {
  household: Household | null;
  role: MemberRole | null;
  profile: UserProfile | null;
  loading: boolean;
  refresh: () => Promise<void>;
  createHousehold: (name: string, size: number) => Promise<void>;
  joinHousehold: (inviteCode: string) => Promise<void>;
  savePreferences: (prefs: Preferences) => Promise<void>;
};

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [household, setHousehold] = useState<Household | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setHousehold(null);
      setRole(null);
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: profileRow } = await supabase
      .from('user_profile')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    setProfile((profileRow as UserProfile) ?? null);

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

  const savePreferences = useCallback(
    async ({ diets, cuisines, goals, mealTimes }: Preferences) => {
      const { error } = await supabase.rpc('save_preferences', {
        p_diet_types: diets,
        p_cuisines: cuisines,
        p_goals: goals,
        p_meal_times: mealTimes ?? null,
      });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  const value = useMemo<HouseholdContextValue>(
    () => ({ household, role, profile, loading, refresh, createHousehold, joinHousehold, savePreferences }),
    [household, role, profile, loading, refresh, createHousehold, joinHousehold, savePreferences]
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold must be used inside <HouseholdProvider>');
  return ctx;
}
