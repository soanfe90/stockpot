/**
 * The library: everything cooked, kept so it can be cooked again.
 *
 * Its real job is to make future plans better, so the two things it must do
 * well are finding a past recipe and putting one back on the schedule.
 */

import { errorMessage, supabase } from './supabase';
import type {
  AdaptResult,
  LibraryRecipe,
  MealPlan,
  PlanTemplate,
  Recipe,
  RecipeStats,
} from './types';

export type LibraryFilters = {
  query: string;
  favouritesOnly: boolean;
  categories: string[];
  cuisines: string[];
  diets: string[];
  minRating: number | null;
  cookedOnly: boolean;
};

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  query: '',
  favouritesOnly: false,
  categories: [],
  cuisines: [],
  diets: [],
  minRating: null,
  cookedOnly: false,
};

export async function loadLibrary(householdId: string): Promise<LibraryRecipe[]> {
  const [recipeRes, statsRes] = await Promise.all([
    supabase.from('recipe').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
    supabase.from('recipe_stats').select('*').eq('household_id', householdId),
  ]);
  if (recipeRes.error) throw recipeRes.error;
  if (statsRes.error) throw statsRes.error;

  const stats = new Map((statsRes.data as RecipeStats[]).map((s) => [s.recipe_id, s]));
  return (recipeRes.data as Recipe[]).map((r) => {
    const s = stats.get(r.id);
    return {
      ...r,
      times_cooked: Number(s?.times_cooked ?? 0),
      avg_rating: s?.avg_rating != null ? Number(s.avg_rating) : null,
      last_cooked: s?.last_cooked ?? null,
      favourite: (r as Recipe & { favourite?: boolean }).favourite ?? false,
    };
  });
}

/** Most recently cooked first, then never-cooked by newest. What the household
 *  actually eats should be the easiest thing to find again. */
export function applyLibraryFilters(recipes: LibraryRecipe[], filters: LibraryFilters): LibraryRecipe[] {
  const needle = filters.query.trim().toLowerCase();

  return recipes
    .filter((r) => {
      if (filters.favouritesOnly && !r.favourite) return false;
      if (filters.cookedOnly && r.times_cooked === 0) return false;
      if (filters.categories.length && !filters.categories.includes(r.category)) return false;
      if (filters.cuisines.length && (!r.cuisine || !filters.cuisines.includes(r.cuisine))) return false;
      if (filters.diets.length && !filters.diets.some((d) => r.diet_types.includes(d))) return false;
      if (filters.minRating != null && (r.avg_rating ?? 0) < filters.minRating) return false;
      if (needle) {
        const haystack = [r.name, r.cuisine ?? '', ...r.diet_types].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.last_cooked && b.last_cooked) return b.last_cooked.localeCompare(a.last_cooked);
      if (a.last_cooked) return -1;
      if (b.last_cooked) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
}

export async function toggleFavourite(recipeId: string, favourite: boolean): Promise<void> {
  const { error } = await supabase.from('recipe').update({ favourite }).eq('id', recipeId);
  if (error) throw error;
}

/** Back onto the schedule as a draft: approving is what reserves stock, and
 *  the phase-4 shortfall machinery then reports anything missing. */
export async function scheduleFromLibrary(
  recipeId: string,
  when: Date,
  servings?: number
): Promise<MealPlan> {
  const { data, error } = await supabase.rpc('schedule_recipe', {
    p_recipe_id: recipeId,
    p_scheduled_at: when.toISOString(),
    p_servings: servings ?? null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as MealPlan;
}

export async function adaptRecipe(
  recipeId: string,
  servings?: number,
  model?: string | null
): Promise<AdaptResult> {
  const { data, error } = await supabase.functions.invoke('adapt-recipe', {
    body: { recipe_id: recipeId, servings, model },
  });
  if (error) throw new Error(await readFunctionError(error));
  return data as AdaptResult;
}

/* ------------------------------------------------------------ templates -- */

export async function loadTemplates(householdId: string): Promise<PlanTemplate[]> {
  const { data, error } = await supabase
    .from('plan_template')
    .select('*')
    .eq('household_id', householdId)
    .order('times_used', { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlanTemplate[];
}

export async function savePlanAsTemplate(planId: string, name: string): Promise<PlanTemplate> {
  const { data, error } = await supabase.rpc('save_plan_as_template', {
    p_plan_id: planId,
    p_name: name,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as PlanTemplate;
}

export async function applyTemplate(templateId: string, startsOn: string): Promise<MealPlan> {
  const { data, error } = await supabase.rpc('apply_template', {
    p_template_id: templateId,
    p_starts_on: startsOn,
    p_tz_offset_minutes: -new Date().getTimezoneOffset(),
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as MealPlan;
}

/* -------------------------------------------------------------- slots ----- */

/** Quick times to put a recipe back on the schedule, so reuse does not need a
 *  date picker for the case that is almost always "tonight" or "tomorrow". */
export function quickSlots(): { label: string; when: Date }[] {
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const options = [
    { label: 'Tonight', when: at(0, 20, 30) },
    { label: 'Tomorrow lunch', when: at(1, 13, 30) },
    { label: 'Tomorrow dinner', when: at(1, 20, 30) },
    { label: 'In three days', when: at(3, 20, 30) },
  ];
  // A slot already in the past helps nobody.
  return options.filter((o) => o.when.getTime() > Date.now());
}

async function readFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      // fall through
    }
  }
  return errorMessage(error);
}
