-- Stockpot :: choosing which Gemini model plans the meals
--
-- Flash is fast and cheap and good enough for a scan; a week of meals built
-- around what is in one particular house is the kind of thing Pro is better
-- at. Which trade-off is right belongs to whoever is paying for the key, so it
-- is a preference rather than a constant.
--
-- The value is checked against an allowlist in the Edge Function before it
-- reaches an API: it arrives from the app and it decides what a call costs.

alter table user_profile
  add column llm_model text;

alter table user_profile add constraint user_profile_llm_model_ck check (
  llm_model is null or llm_model in ('gemini-2.5-flash', 'gemini-2.5-pro')
);

comment on column user_profile.llm_model is
  'Gemini model for this member''s generated plans and scans. Null means the '
  'server default (GEMINI_MODEL).';

drop function if exists save_preferences(text, text[], text[], text[], text[], jsonb, int[]);

create or replace function save_preferences(
  p_display_name  text default null,
  p_diet_types    text[] default '{}',
  p_cuisines      text[] default '{}',
  p_goals         text[] default '{}',
  p_allergens     text[] default '{}',
  p_meal_times    jsonb default null,
  p_shopping_days int[] default null,
  p_llm_model     text default null
)
returns user_profile
language plpgsql
security definer
set search_path = public
as $$
declare
  profile user_profile;
  times jsonb := coalesce(p_meal_times, '{"breakfast":480,"lunch":780,"dinner":1200,"snack":1020}'::jsonb);
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  insert into user_profile (
    user_id, display_name, diet_types, cuisines, goals, allergens,
    meal_times, shopping_days, llm_model, onboarded_at
  )
  values (
    auth.uid(), p_display_name, p_diet_types, p_cuisines, p_goals, p_allergens,
    times, coalesce(p_shopping_days, '{6}'), p_llm_model, now()
  )
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, user_profile.display_name),
    diet_types   = excluded.diet_types,
    cuisines     = excluded.cuisines,
    goals        = excluded.goals,
    allergens    = excluded.allergens,
    -- Null means "leave it alone": a caller editing diets only must not reset
    -- mealtimes, shopping days or the model as a side effect.
    meal_times    = coalesce(p_meal_times, user_profile.meal_times),
    shopping_days = coalesce(p_shopping_days, user_profile.shopping_days),
    llm_model     = coalesce(p_llm_model, user_profile.llm_model),
    onboarded_at  = coalesce(user_profile.onboarded_at, now())
  returning * into profile;

  return profile;
end;
$$;

revoke execute on function save_preferences(text, text[], text[], text[], text[], jsonb, int[], text) from public;
grant  execute on function save_preferences(text, text[], text[], text[], text[], jsonb, int[], text) to authenticated;
