-- Stockpot :: Phase 5 (Library)
--
-- Everything cooked, kept so it can be cooked again. The library's real job is
-- not nostalgia: it makes future plans cheaper and better by recycling what
-- this household already liked, and it is where a plan stops being a one-off.

alter table recipe add column favourite boolean not null default false;

create index recipe_favourite_idx on recipe(household_id) where favourite;

-- A saved day or week. The shape is stored rather than the plan itself,
-- because applying it later must be re-validated against the pantry as it is
-- then -- same rhythm, different ingredients where stock has moved on.
create table plan_template (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  scope        plan_scope not null,
  -- [{ day_offset, category, recipe_id, servings }]
  shape        jsonb not null default '[]',
  times_used   int not null default 0,
  created_at   timestamptz not null default now()
);

create index plan_template_household_idx on plan_template(household_id, created_at desc);

-- --------------------------------------------------------------- stats ----

-- What the household actually thinks of each recipe. Most-cooked and
-- highest-rated together are the real taste profile, and both feed generation.
create view recipe_stats with (security_invoker = true) as
select
  r.id                                    as recipe_id,
  r.household_id,
  count(cl.id)                            as times_cooked,
  round(avg(cl.rating)::numeric, 2)       as avg_rating,
  max(cl.finished_at)                     as last_cooked
from recipe r
left join cook_log cl on cl.recipe_id = r.id
group by r.id;

-- ------------------------------------------------------------- reuse ------

-- Drops a saved recipe into the schedule as a one-meal draft plan. Draft, not
-- active: approving is what reserves stock, and the shortfall machinery from
-- phase 4 then reports anything missing and can push it to the shopping list.
create or replace function schedule_recipe(
  p_recipe_id   uuid,
  p_scheduled_at timestamptz,
  p_servings    int default null
)
returns meal_plan
language plpgsql
security definer
set search_path = public
as $$
declare
  rec  recipe;
  plan meal_plan;
begin
  select * into rec from recipe where id = p_recipe_id;
  if not found then
    raise exception 'Unknown recipe' using errcode = 'P0002';
  end if;
  if not is_household_member(rec.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  insert into meal_plan (household_id, scope, starts_on, ends_on, status, prefs)
  values (rec.household_id, 'single', p_scheduled_at::date, p_scheduled_at::date, 'draft',
          jsonb_build_object('from_library', true, 'recipe_id', p_recipe_id))
  returning * into plan;

  insert into meal_slot (
    plan_id, household_id, recipe_id, scheduled_at, category, servings, notify_at
  ) values (
    plan.id, rec.household_id, rec.id, p_scheduled_at, rec.category,
    coalesce(p_servings, rec.servings), p_scheduled_at - interval '30 minutes'
  );

  return plan;
end;
$$;

-- When each meal lands, in local time. Mirrors MEAL_HOUR in generate-plan.
create or replace function meal_hour(p_category text)
returns interval
language sql
immutable
as $$
  select case p_category
    when 'breakfast' then interval '8 hours'
    when 'lunch'     then interval '13 hours 30 minutes'
    when 'snack'     then interval '17 hours'
    else                  interval '20 hours 30 minutes'
  end;
$$;

-- ---------------------------------------------------------- templates -----

create or replace function save_plan_as_template(p_plan_id uuid, p_name text)
returns plan_template
language plpgsql
security definer
set search_path = public
as $$
declare
  plan meal_plan;
  tpl  plan_template;
begin
  select * into plan from meal_plan where id = p_plan_id;
  if not found then
    raise exception 'Unknown plan' using errcode = 'P0002';
  end if;
  if not is_household_member(plan.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  insert into plan_template (household_id, name, scope, shape)
  select
    plan.household_id,
    trim(p_name),
    plan.scope,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'day_offset', (ms.scheduled_at::date - plan.starts_on),
        'category',   ms.category,
        'recipe_id',  ms.recipe_id,
        'servings',   ms.servings
      ) order by ms.scheduled_at
    ), '[]'::jsonb)
  from meal_slot ms
  where ms.plan_id = p_plan_id
    and ms.status <> 'skipped'
  returning * into tpl;

  if jsonb_array_length(tpl.shape) = 0 then
    delete from plan_template where id = tpl.id;
    raise exception 'That plan has no meals to save' using errcode = '22023';
  end if;

  return tpl;
end;
$$;

-- Applies a template to a new date as a *draft*. It is a strong suggestion,
-- not a copy: approving re-checks it against the pantry as it is now, and
-- whatever is missing goes to the shopping list like any other plan.
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
                 + meal_hour(entry->>'category')
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

-- ------------------------------------------------------------------ RLS ---

alter table plan_template enable row level security;

create policy plan_template_all on plan_template
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

revoke execute on function schedule_recipe(uuid, timestamptz, int)   from public;
revoke execute on function save_plan_as_template(uuid, text)         from public;
revoke execute on function apply_template(uuid, date, int)           from public;
revoke execute on function meal_hour(text)                           from public;

grant execute on function schedule_recipe(uuid, timestamptz, int)   to authenticated;
grant execute on function save_plan_as_template(uuid, text)         to authenticated;
grant execute on function apply_template(uuid, date, int)           to authenticated;
grant execute on function meal_hour(text)                           to authenticated;
