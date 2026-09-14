-- Stockpot :: meal times, slot rescheduling, ingredient edits
--
-- Three gaps this closes:
--
--  1. Mealtimes were hard-coded in two places (meal_hour here, MEAL_HOUR in
--     generate-plan) and were nobody's actual schedule. They now live on the
--     profile, defaulting to 08:00 / 13:00 / 20:00 with a 17:00 snack.
--  2. A scheduled meal could not be moved. Time is not stock, so moving one
--     touches no reservation -- it is a plain update behind a membership check.
--  3. A generated recipe's ingredients could not be corrected. They can be,
--     but only while nothing depends on them: never once the recipe has been
--     cooked, and never once a plan holding it has reserved stock against it.

-- ------------------------------------------------------------ mealtimes ---

-- Minutes from local midnight, per category. Minutes rather than a time so the
-- arithmetic against a date is a plain interval, and jsonb rather than four
-- columns so adding a category later is not another migration.
alter table user_profile
  add column meal_times jsonb not null
    default '{"breakfast":480,"lunch":780,"dinner":1200,"snack":1020}'::jsonb;

alter table user_profile add constraint user_profile_meal_times_ck check (
  meal_times ?& array['breakfast', 'lunch', 'dinner', 'snack']
  and (meal_times->>'breakfast')::int between 0 and 1439
  and (meal_times->>'lunch')::int     between 0 and 1439
  and (meal_times->>'dinner')::int    between 0 and 1439
  and (meal_times->>'snack')::int     between 0 and 1439
);

-- The signed-in member's mealtimes, or the defaults if they have no profile
-- row yet. security definer because a plan can be applied before the profile
-- is readable under the caller's own policies.
create or replace function my_meal_times()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select meal_times from user_profile where user_id = auth.uid()),
    '{"breakfast":480,"lunch":780,"dinner":1200,"snack":1020}'::jsonb
  );
$$;

-- Replaces meal_hour(). Mirrors mealMinutes in generate-plan.
create or replace function meal_offset(p_category text, p_times jsonb default null)
returns interval
language sql
stable
as $$
  select make_interval(mins => coalesce(
    (coalesce(p_times, my_meal_times())->>p_category)::int,
    case p_category
      when 'breakfast' then 480
      when 'lunch'     then 780
      when 'snack'     then 1020
      else                  1200
    end
  ));
$$;

-- Same body as before but reading the caller's mealtimes instead of the
-- hard-coded ones. Recreated before meal_hour is dropped.
create or replace function apply_template(
  p_template_id uuid,
  p_starts_on   date,
  p_tz_offset_minutes int default 0
)
returns meal_plan
language plpgsql
security definer
set search_path = public
as $$
declare
  tpl   plan_template;
  plan  meal_plan;
  entry jsonb;
  rec   recipe;
  times jsonb := my_meal_times();
  slot_time timestamptz;
  max_offset int := 0;
  n int := 0;
begin
  select * into tpl from plan_template where id = p_template_id;
  if not found then
    raise exception 'Unknown template' using errcode = 'P0002';
  end if;
  if not is_household_member(tpl.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  for entry in select * from jsonb_array_elements(tpl.shape) loop
    max_offset := greatest(max_offset, (entry->>'day_offset')::int);
  end loop;

  insert into meal_plan (household_id, scope, starts_on, ends_on, status, prefs)
  values (tpl.household_id, tpl.scope, p_starts_on, p_starts_on + max_offset, 'draft',
          jsonb_build_object('from_template', tpl.id))
  returning * into plan;

  for entry in select * from jsonb_array_elements(tpl.shape) loop
    -- A recipe deleted since the template was saved is skipped rather than
    -- failing the whole apply.
    select * into rec from recipe where id = (entry->>'recipe_id')::uuid;
    continue when not found;

    slot_time := (p_starts_on + (entry->>'day_offset')::int)::timestamp
                 + meal_offset(entry->>'category', times)
                 - make_interval(mins => p_tz_offset_minutes);

    insert into meal_slot (
      plan_id, household_id, recipe_id, scheduled_at, category, servings, notify_at, position
    ) values (
      plan.id, tpl.household_id, rec.id, slot_time, (entry->>'category')::meal_category,
      (entry->>'servings')::int, slot_time - interval '30 minutes', n
    );
    n := n + 1;
  end loop;

  if n = 0 then
    delete from meal_plan where id = plan.id;
    raise exception 'None of that template''s recipes still exist' using errcode = 'P0002';
  end if;

  update plan_template set times_used = times_used + 1 where id = p_template_id;

  return plan;
end;
$$;

drop function if exists meal_hour(text);

-- ---------------------------------------------------------- preferences ---

-- The argument list changes, so the old function is dropped rather than
-- replaced -- otherwise both signatures stay callable and the four-argument
-- one silently keeps writing the old defaults.
drop function if exists save_preferences(text, text[], text[], text[], text[]);

create or replace function save_preferences(
  p_display_name text default null,
  p_diet_types   text[] default '{}',
  p_cuisines     text[] default '{}',
  p_goals        text[] default '{}',
  p_allergens    text[] default '{}',
  p_meal_times   jsonb default null
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

  insert into user_profile (user_id, display_name, diet_types, cuisines, goals, allergens, meal_times, onboarded_at)
  values (auth.uid(), p_display_name, p_diet_types, p_cuisines, p_goals, p_allergens, times, now())
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, user_profile.display_name),
    diet_types   = excluded.diet_types,
    cuisines     = excluded.cuisines,
    goals        = excluded.goals,
    allergens    = excluded.allergens,
    -- Null means "leave them alone": a caller editing diets only must not
    -- reset mealtimes to the defaults as a side effect.
    meal_times   = coalesce(p_meal_times, user_profile.meal_times),
    onboarded_at = coalesce(user_profile.onboarded_at, now())
  returning * into profile;

  return profile;
end;
$$;

-- ---------------------------------------------------------- rescheduling --

-- Moving a meal changes when it is cooked, not what it costs, so no
-- reservation is touched. A meal already being cooked or finished is fixed in
-- the past and will not move.
create or replace function reschedule_slot(p_slot_id uuid, p_scheduled_at timestamptz)
returns meal_slot
language plpgsql
security definer
set search_path = public
as $$
declare slot meal_slot;
begin
  select * into slot from meal_slot where id = p_slot_id for update;
  if not found then
    raise exception 'Unknown meal' using errcode = 'P0002';
  end if;
  if not is_household_member(slot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if slot.status <> 'planned' then
    raise exception 'That meal is already underway' using errcode = '22023';
  end if;

  update meal_slot
     set scheduled_at = p_scheduled_at,
         notify_at    = p_scheduled_at - interval '30 minutes'
   where id = p_slot_id
  returning * into slot;

  return slot;
end;
$$;

-- --------------------------------------------------- ingredient editing ---

-- A recipe is editable only while nothing has been committed against it: it
-- has never been cooked, and no plan holding it has reserved stock. Anything
-- else has to fork (adapt_recipe), because the library must keep what was
-- actually made.
create or replace function assert_recipe_editable(p_recipe_id uuid)
returns recipe
language plpgsql
stable
security definer
set search_path = public
as $$
declare rec recipe;
begin
  select * into rec from recipe where id = p_recipe_id;
  if not found then
    raise exception 'Unknown recipe' using errcode = 'P0002';
  end if;
  if not is_household_member(rec.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if exists (select 1 from cook_log where recipe_id = p_recipe_id) then
    raise exception 'That recipe has been cooked -- adapt it instead of editing it'
      using errcode = '22023';
  end if;
  if exists (
    select 1
      from meal_slot s
      join meal_plan p on p.id = s.plan_id
     where s.recipe_id = p_recipe_id
       and p.status <> 'draft'
  ) then
    raise exception 'Its ingredients are reserved by an approved plan' using errcode = '22023';
  end if;

  return rec;
end;
$$;

create or replace function set_ingredient_qty(p_ingredient_id uuid, p_qty numeric)
returns recipe_ingredient
language plpgsql
security definer
set search_path = public
as $$
declare
  line recipe_ingredient;
begin
  select * into line from recipe_ingredient where id = p_ingredient_id;
  if not found then
    raise exception 'Unknown ingredient' using errcode = 'P0002';
  end if;
  perform assert_recipe_editable(line.recipe_id);

  if p_qty < 0 then
    raise exception 'A quantity cannot be negative' using errcode = '22023';
  end if;

  update recipe_ingredient set qty = p_qty where id = p_ingredient_id
  returning * into line;

  return line;
end;
$$;

create or replace function remove_ingredient(p_ingredient_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare line recipe_ingredient;
begin
  select * into line from recipe_ingredient where id = p_ingredient_id;
  if not found then
    return;
  end if;
  perform assert_recipe_editable(line.recipe_id);

  delete from recipe_ingredient where id = p_ingredient_id;
end;
$$;

-- Added ingredients come from the pantry, never free text: a plan is only
-- honest if every line can actually be deducted when the meal is cooked.
create or replace function add_ingredient(p_recipe_id uuid, p_product_id uuid, p_qty numeric)
returns recipe_ingredient
language plpgsql
security definer
set search_path = public
as $$
declare
  rec  recipe;
  prod product;
  line recipe_ingredient;
begin
  rec := assert_recipe_editable(p_recipe_id);

  select * into prod from product where id = p_product_id;
  if not found or prod.household_id <> rec.household_id then
    raise exception 'Unknown product' using errcode = 'P0002';
  end if;
  if p_qty <= 0 then
    raise exception 'Add a quantity greater than zero' using errcode = '22023';
  end if;
  if exists (select 1 from recipe_ingredient where recipe_id = p_recipe_id and product_id = p_product_id) then
    raise exception 'That ingredient is already in this recipe' using errcode = '23505';
  end if;

  insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit, optional, position)
  values (
    p_recipe_id, prod.id, prod.name, p_qty, prod.display_unit, prod.base_unit, false,
    coalesce((select max(position) + 1 from recipe_ingredient where recipe_id = p_recipe_id), 0)
  )
  returning * into line;

  return line;
end;
$$;

-- ------------------------------------------------------------------ RLS ---

revoke execute on function my_meal_times()                                      from public;
revoke execute on function meal_offset(text, jsonb)                             from public;
revoke execute on function save_preferences(text, text[], text[], text[], text[], jsonb) from public;
revoke execute on function reschedule_slot(uuid, timestamptz)                   from public;
revoke execute on function assert_recipe_editable(uuid)                         from public;
revoke execute on function set_ingredient_qty(uuid, numeric)                    from public;
revoke execute on function remove_ingredient(uuid)                              from public;
revoke execute on function add_ingredient(uuid, uuid, numeric)                  from public;

grant execute on function my_meal_times()                                       to authenticated;
grant execute on function meal_offset(text, jsonb)                              to authenticated;
grant execute on function save_preferences(text, text[], text[], text[], text[], jsonb) to authenticated;
grant execute on function reschedule_slot(uuid, timestamptz)                    to authenticated;
grant execute on function assert_recipe_editable(uuid)                          to authenticated;
grant execute on function set_ingredient_qty(uuid, numeric)                     to authenticated;
grant execute on function remove_ingredient(uuid)                               to authenticated;
grant execute on function add_ingredient(uuid, uuid, numeric)                   to authenticated;
