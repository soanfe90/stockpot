-- Stockpot :: which meals a household actually plans, and pushing a plan back
--
-- The planner assumed three meals a day, every day, for everybody. Plenty of
-- people eat twice; plenty cook dinner only; snacks are a preference, not a
-- fixture. And a plan for a week assumed the week would be spent at home.
--
-- Two things fix that. Which meals to plan becomes a preference, and a plan
-- that has been overtaken by life can be pushed back rather than abandoned --
-- somebody away for two days wants those meals on Thursday, not deleted.

alter table user_profile
  add column planned_meals text[] not null default '{breakfast,lunch,dinner}';

-- array_length of an empty array is NULL, not 0, and a check constraint passes
-- on NULL -- so "> 0" would have let a household plan no meals at all. Unlike
-- shopping_days, where never shopping is a real answer, planning nothing is
-- not a preference: it is a form somebody emptied by accident.
alter table user_profile add constraint user_profile_planned_meals_ck check (
  planned_meals <@ array['breakfast', 'lunch', 'dinner', 'snack']
  and array_length(planned_meals, 1) is not null
);

comment on column user_profile.planned_meals is
  'Which meals of the day to generate. Snacks are opt-in; two meals a day is a '
  'perfectly ordinary answer.';

drop function if exists save_preferences(text, text[], text[], text[], text[], jsonb, int[], text);

create or replace function save_preferences(
  p_display_name  text default null,
  p_diet_types    text[] default '{}',
  p_cuisines      text[] default '{}',
  p_goals         text[] default '{}',
  p_allergens     text[] default '{}',
  p_meal_times    jsonb default null,
  p_shopping_days int[] default null,
  p_llm_model     text default null,
  p_planned_meals text[] default null
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
    meal_times, shopping_days, llm_model, planned_meals, onboarded_at
  )
  values (
    auth.uid(), p_display_name, p_diet_types, p_cuisines, p_goals, p_allergens,
    times, coalesce(p_shopping_days, '{6}'), p_llm_model,
    coalesce(p_planned_meals, '{breakfast,lunch,dinner}'), now()
  )
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, user_profile.display_name),
    diet_types   = excluded.diet_types,
    cuisines     = excluded.cuisines,
    goals        = excluded.goals,
    allergens    = excluded.allergens,
    -- Null means "leave it alone": a caller editing diets only must not reset
    -- the rest as a side effect.
    meal_times    = coalesce(p_meal_times, user_profile.meal_times),
    shopping_days = coalesce(p_shopping_days, user_profile.shopping_days),
    llm_model     = coalesce(p_llm_model, user_profile.llm_model),
    planned_meals = coalesce(p_planned_meals, user_profile.planned_meals),
    onboarded_at  = coalesce(user_profile.onboarded_at, now())
  returning * into profile;

  return profile;
end;
$$;

-- Pushes the rest of a plan back, keeping its shape.
--
-- Not the same as skipping, which is what the app could do before: skipping
-- says the meal did not happen and hands its ingredients back. Being away for
-- two days does not mean giving up on Wednesday's dinner -- it means eating it
-- on Friday. The reservations stay exactly as they are, because the food is
-- still spoken for by the same meals.
create or replace function shift_plan(p_plan_id uuid, p_from date, p_days int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  plan meal_plan;
  n    int;
begin
  if p_days = 0 then
    return 0;
  end if;

  select * into plan from meal_plan where id = p_plan_id for update;
  if not found then
    raise exception 'Unknown plan' using errcode = 'P0002';
  end if;
  if not is_household_member(plan.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  -- Only meals not yet underway. One being cooked is happening now, and one
  -- already eaten is a record of a day that really occurred.
  with moved as (
    update meal_slot
       set scheduled_at = scheduled_at + make_interval(days => p_days),
           notify_at    = notify_at + make_interval(days => p_days)
     where plan_id = p_plan_id
       and status = 'planned'
       and scheduled_at::date >= p_from
    returning 1
  )
  select count(*) into n from moved;

  -- The plan's own span follows its meals, or the Meals tab and the shortfall
  -- deadlines end up describing a week that no longer matches.
  update meal_plan
     set ends_on = greatest(ends_on, (
           select max(scheduled_at::date) from meal_slot where plan_id = p_plan_id
         ))
   where id = p_plan_id;

  return n;
end;
$$;

revoke execute on function save_preferences(text, text[], text[], text[], text[], jsonb, int[], text, text[]) from public;
revoke execute on function shift_plan(uuid, date, int) from public;
grant  execute on function save_preferences(text, text[], text[], text[], text[], jsonb, int[], text, text[]) to authenticated;
grant  execute on function shift_plan(uuid, date, int) to authenticated;
