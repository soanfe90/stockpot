-- Stockpot :: which days the household can actually shop
--
-- A plan that may buy things has to know when they can be bought. "At most two
-- shopping days" was an abstraction standing in for a real fact about a
-- household: somebody who shops on Saturdays and somebody who shops Tuesdays
-- and Fridays should not get the same week of meals, and the one who goes once
-- should be asked to buy less, not the same amount on a tighter deadline.
--
-- ISO weekdays, 1 = Monday through 7 = Sunday. An empty array is a real
-- answer, not a missing one: it means "do not plan around a shop at all", and
-- the plan comes entirely from what is already in.

alter table user_profile
  add column shopping_days int[] not null default '{6}';

alter table user_profile add constraint user_profile_shopping_days_ck check (
  shopping_days <@ array[1, 2, 3, 4, 5, 6, 7]
  and array_length(shopping_days, 1) is distinct from 0
);

comment on column user_profile.shopping_days is
  'ISO weekdays (1=Monday) the household can get to a supermarket. Empty means '
  'never: plans are then built from stock alone.';

-- The argument list changes, so the old function is dropped rather than
-- replaced -- otherwise both signatures stay callable and the shorter one
-- silently keeps writing the old defaults.
drop function if exists save_preferences(text, text[], text[], text[], text[], jsonb);

create or replace function save_preferences(
  p_display_name  text default null,
  p_diet_types    text[] default '{}',
  p_cuisines      text[] default '{}',
  p_goals         text[] default '{}',
  p_allergens     text[] default '{}',
  p_meal_times    jsonb default null,
  p_shopping_days int[] default null
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
    meal_times, shopping_days, onboarded_at
  )
  values (
    auth.uid(), p_display_name, p_diet_types, p_cuisines, p_goals, p_allergens,
    times, coalesce(p_shopping_days, '{6}'), now()
  )
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, user_profile.display_name),
    diet_types   = excluded.diet_types,
    cuisines     = excluded.cuisines,
    goals        = excluded.goals,
    allergens    = excluded.allergens,
    -- Null means "leave them alone": a caller editing diets only must not
    -- reset mealtimes or shopping days to the defaults as a side effect.
    meal_times    = coalesce(p_meal_times, user_profile.meal_times),
    shopping_days = coalesce(p_shopping_days, user_profile.shopping_days),
    onboarded_at  = coalesce(user_profile.onboarded_at, now())
  returning * into profile;

  return profile;
end;
$$;

revoke execute on function save_preferences(text, text[], text[], text[], text[], jsonb, int[]) from public;
grant  execute on function save_preferences(text, text[], text[], text[], text[], jsonb, int[]) to authenticated;
