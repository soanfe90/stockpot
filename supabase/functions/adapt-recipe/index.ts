/**
 * adapt-recipe
 *
 * Refits a saved recipe to the pantry as it is today: substitutions where
 * something has run out, adjusted amounts where stock is short. The original
 * is never modified -- adaptation forks a new recipe that keeps a link to its
 * parent, so the library always holds the version that was actually cooked.
 *
 * The model provider is chosen by LLM_PROVIDER (see _shared/llm.ts).
 *
 *   supabase functions deploy adapt-recipe
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4.6.1';

import { enforcePlan, STAPLES } from '../_shared/budget.ts';
import { corsHeaders, fail, json } from '../_shared/cors.ts';
import { activeProvider, generateStructured } from '../_shared/llm.ts';

const AdaptedSchema = z.object({
  name: z.string().describe('Keep the original name unless the dish genuinely changed'),
  est_minutes: z.number(),
  servings: z.number(),
  total_calories: z.number(),
  steps: z.array(z.string()),
  tips: z.array(z.string()),
  /** What changed and why, in the user's words, not the model's. */
  changes: z.array(z.string()),
  ingredients: z.array(
    z.object({
      product_id: z.string().nullable(),
      name: z.string(),
      qty: z.number(),
      display_unit: z.string(),
      optional: z.boolean(),
    })
  ),
});

const SYSTEM_RULES = `You refit an existing recipe to a household's current pantry.

- Keep the dish recognisably itself. This is an adaptation, not a new recipe:
  if the pantry cannot support the dish at all, say so in changes and return
  the closest honest version rather than something unrelated.
- Every tracked ingredient must come from the pantry list, referenced by its
  exact product_id, and must not exceed the amount available. Untracked
  staples (salt, pepper, water, cooking oil) may use product_id null.
- Prefer substitutions the household already has over dropping a component.
- Quantities are in each product's base unit, as the pantry list states.
- changes must name each substitution or adjustment in plain language, one per
  entry: "used rice instead of orzo", "halved the chicken, only 300 g left".
  This is what the user reads to decide whether to accept the adaptation.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Use POST.', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return fail('Missing Authorization header.', 401);

  let body: { recipe_id: string; servings?: number; model?: string | null };
  try {
    body = await req.json();
  } catch {
    return fail('Send a JSON body with a recipe_id.');
  }
  if (!body.recipe_id) return fail('recipe_id is required.');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  try {
    const { data: recipe, error: recipeError } = await supabase
      .from('recipe').select('*').eq('id', body.recipe_id).single();
    if (recipeError || !recipe) return fail('That recipe does not exist, or is not yours.', 404);

    const { data: original } = await supabase
      .from('recipe_ingredient').select('*').eq('recipe_id', body.recipe_id).order('position');

    const [{ data: products }, { data: stock }] = await Promise.all([
      supabase.from('product').select('id, name, category, base_unit, display_unit')
        .eq('household_id', recipe.household_id),
      supabase.from('product_stock').select('*').eq('household_id', recipe.household_id),
    ]);

    const stockById = new Map((stock ?? []).map((s) => [s.product_id, s]));
    const pantry = (products ?? [])
      .map((p) => {
        const s = stockById.get(p.id);
        return {
          product_id: p.id,
          name: p.name,
          category: p.category,
          base_unit: p.base_unit,
          available: Math.max(Number(s?.qty_total ?? 0) - Number(s?.qty_reserved ?? 0), 0),
        };
      })
      .filter((p) => p.available > 0);

    if (pantry.length === 0) {
      return fail('There is nothing in the pantry to adapt this to yet.', 409);
    }

    const adapted = await generateStructured({
      label: 'Adapting the recipe',
      model: body.model ?? null,
      schema: AdaptedSchema,
      maxOutputTokens: 16000,
      system: [SYSTEM_RULES, '', `Untracked staples: ${STAPLES.join(', ')}.`].join('\n'),
      parts: [
        {
          type: 'text',
          text: [
            `Recipe: ${JSON.stringify({ ...recipe, ingredients: original ?? [] })}`,
            ``,
            `Pantry: ${JSON.stringify(pantry)}`,
            ``,
            `Refit it for ${body.servings ?? recipe.servings} servings.`,
          ].join('\n'),
        },
      ],
    });

    // The same guard the planner uses, with no allowance to buy anything:
    // adapting exists precisely to fit a dish to what is in the house right
    // now, so "go and buy something" is not an answer it may give.
    const { accepted, violations } = enforcePlan(
      [
        {
          day_offset: 0,
          name: adapted.name,
          ingredients: adapted.ingredients.map((ing) => ({
            ...ing,
            source: (ing.product_id ? 'pantry' : 'staple') as 'pantry' | 'staple',
          })),
        },
      ],
      pantry,
      { shoppingDays: [], maxNewProducts: 0, pantryOnlyDays: 1 }
    );
    if (accepted.length === 0) {
      return fail(
        `That recipe cannot be made from what is in the pantry right now. ${violations[0] ?? ''}`.trim(),
        422
      );
    }

    // Fork: the original stays exactly as it was cooked.
    const { data: fork, error: forkError } = await supabase
      .from('recipe')
      .insert({
        household_id: recipe.household_id,
        name: adapted.name,
        category: recipe.category,
        diet_types: recipe.diet_types,
        cuisine: recipe.cuisine,
        est_minutes: Math.round(adapted.est_minutes),
        servings: Math.max(1, Math.round(adapted.servings)),
        total_calories: Math.round(adapted.total_calories),
        steps: adapted.steps,
        tips: adapted.tips,
        source: 'generated',
        parent_recipe_id: recipe.id,
      })
      .select()
      .single();
    if (forkError) throw forkError;

    const rows = adapted.ingredients.map((ing, index) => ({
      recipe_id: fork.id,
      product_id: ing.product_id,
      name: ing.name,
      qty: Math.max(0, ing.qty),
      display_unit: ing.display_unit,
      base_unit: pantry.find((p) => p.product_id === ing.product_id)?.base_unit ?? 'g',
      optional: ing.optional,
      position: index,
    }));
    const { error: ingError } = await supabase.from('recipe_ingredient').insert(rows);
    if (ingError) throw ingError;

    return json({
      provider: activeProvider(),
      recipe_id: fork.id,
      parent_recipe_id: recipe.id,
      changes: adapted.changes,
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
});
