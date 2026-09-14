\set ON_ERROR_STOP on
-- Phase 5: recipes come back. Stats reflect what was actually cooked, a saved
-- recipe returns to the schedule as a draft, and a template is a suggestion
-- re-checked against today's pantry rather than a copy.

insert into auth.users (id) values
  ('11112222-3333-4444-5555-666677778888'),
  ('99990000-1111-2222-3333-444455556666');

set role authenticated;
set request.jwt.claim.sub = '11112222-3333-4444-5555-666677778888';

select id as hh from create_household('Casa Recetas', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit, default_useful_life_days)
values (:'hh', 'Pasta', 'Grains & Pasta', 'g', 'g', 365) returning id as pasta \gset
\o /dev/null
select add_stock(:'pasta', 2000, current_date + 200);
\o

insert into recipe (household_id, name, category, cuisine, servings, est_minutes, total_calories, source)
values (:'hh', 'Pasta al pomodoro', 'dinner', 'Italian', 2, 25, 540, 'generated')
returning id as rcp \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit, position)
values (:'rcp', :'pasta', 'Pasta', 200, 'g', 'g', 0);

-- Cook it twice, rated 4 then 5.
insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'day', current_date, current_date, 'active') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings, position)
-- Anchored to midnight, not to the clock: "now() + 1 hour" is tomorrow when
-- the suite runs late in the evening, and the template's day_offset assertion
-- below then fails for an hour every night.
values (:'plan', :'hh', :'rcp', current_date + interval '13 hours', 'lunch',  2, 0),
       (:'plan', :'hh', :'rcp', current_date + interval '20 hours', 'dinner', 2, 1);
\o /dev/null
select finish_cooking(id, 2, 4) from meal_slot where category = 'lunch';
select finish_cooking(id, 2, 5) from meal_slot where category = 'dinner';
\o
\echo '  [1] a recipe cooked twice, rated 4 and 5'

do $$
declare s record;
begin
  select * into s from recipe_stats where recipe_id = (select id from recipe limit 1);
  if s.times_cooked <> 2 then raise exception 'FAIL: times_cooked is %, expected 2', s.times_cooked; end if;
  if s.avg_rating <> 4.5 then raise exception 'FAIL: avg_rating is %, expected 4.50', s.avg_rating; end if;
  if s.last_cooked is null then raise exception 'FAIL: last_cooked not recorded'; end if;
end $$;
\echo '  [2] recipe_stats reflects what was actually cooked, not what was planned'

update recipe set favourite = true where id = :'rcp';
do $$ begin
  if not exists (select 1 from recipe where favourite) then raise exception 'FAIL: favourite did not stick'; end if;
end $$;
\echo '  [3] a recipe can be marked a favourite'

-- Reuse: back into the schedule as a draft, so approving is what reserves.
do $$
declare p meal_plan; slots int;
begin
  p := schedule_recipe((select id from recipe limit 1), current_date + interval '2 days 13 hours', 4);
  if p.status <> 'draft' then raise exception 'FAIL: reuse should produce a draft, got %', p.status; end if;
  select count(*) into slots from meal_slot where plan_id = p.id;
  if slots <> 1 then raise exception 'FAIL: expected 1 slot, got %', slots; end if;
  if (select servings from meal_slot where plan_id = p.id) <> 4
    then raise exception 'FAIL: the requested servings were not used'; end if;
  if (select notify_at from meal_slot where plan_id = p.id)
     <> (select scheduled_at - interval '30 minutes' from meal_slot where plan_id = p.id)
    then raise exception 'FAIL: the reminder was not set 30 minutes before'; end if;
end $$;
\echo '  [4] a library recipe returns to the schedule as a draft, with its reminder'

-- Its ingredients are not claimed until it is approved.
do $$
declare claimed numeric;
begin
  select qty_reserved into claimed from product_stock where product_id = (select id from product limit 1);
  if claimed <> 0 then raise exception 'FAIL: a draft should reserve nothing, found %', claimed; end if;

  perform approve_plan((select id from meal_plan where scope = 'single'));
  select qty_reserved into claimed from product_stock where product_id = (select id from product limit 1);
  -- 200 g for two, scaled to four.
  if claimed <> 400 then raise exception 'FAIL: expected 400 g claimed, got %', claimed; end if;
end $$;
\echo '  [5] nothing is reserved until approval, then it scales with servings'

-- Templates
do $$
declare tpl plan_template;
begin
  tpl := save_plan_as_template((select id from meal_plan where scope = 'day'), 'Semana normal');
  if jsonb_array_length(tpl.shape) <> 2 then
    raise exception 'FAIL: template shape has % entries, expected 2', jsonb_array_length(tpl.shape);
  end if;
  if (tpl.shape->0->>'day_offset')::int <> 0 then raise exception 'FAIL: day_offset not relative to the start'; end if;
end $$;
\echo '  [6] a finished plan saved as a template, offsets relative to its start'

do $$
declare p meal_plan; slots int;
begin
  p := apply_template((select id from plan_template limit 1), current_date + 7, 0);
  if p.status <> 'draft' then raise exception 'FAIL: applying a template must produce a draft'; end if;
  select count(*) into slots from meal_slot where plan_id = p.id;
  if slots <> 2 then raise exception 'FAIL: expected 2 slots from the template, got %', slots; end if;
  if (select times_used from plan_template limit 1) <> 1 then raise exception 'FAIL: times_used not incremented'; end if;
  -- Lunch lands at 13:00 local -- the profile default, since this member
  -- never changed their mealtimes.
  if (select extract(hour from scheduled_at) from meal_slot
      where plan_id = p.id and category = 'lunch') <> 13
    then raise exception 'FAIL: the meal did not land at its usual hour'; end if;
end $$;
\echo '  [7] a template applies to a new week as a draft, at the usual mealtimes'

-- A recipe deleted since the template was saved must not break the apply.
insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Receta temporal', 'lunch', 2, 'user') returning id as tmp \gset
insert into plan_template (household_id, name, scope, shape)
values (:'hh', 'Con receta borrada', 'day',
        jsonb_build_array(
          jsonb_build_object('day_offset', 0, 'category', 'lunch',  'recipe_id', :'tmp', 'servings', 2),
          jsonb_build_object('day_offset', 0, 'category', 'dinner', 'recipe_id', :'rcp', 'servings', 2)
        ));
delete from recipe where id = :'tmp';
do $$
declare p meal_plan;
begin
  p := apply_template((select id from plan_template where name = 'Con receta borrada'), current_date + 14, 0);
  if (select count(*) from meal_slot where plan_id = p.id) <> 1 then
    raise exception 'FAIL: the surviving recipe should still be scheduled';
  end if;
end $$;
\echo '  [8] a template whose recipe was deleted skips it instead of failing'

insert into meal_plan (household_id, scope, starts_on, ends_on)
values (:'hh', 'day', current_date + 30, current_date + 30);
do $$ begin
  begin
    perform save_plan_as_template(
      (select id from meal_plan where starts_on = current_date + 30), 'Vacío');
    raise exception 'FAIL: an empty plan was saved as a template';
  -- Only the specific refusal is swallowed; the FAIL above still propagates.
  exception when sqlstate '22023' then null;
  end;
end $$;

do $$ begin
  if exists (select 1 from plan_template where name = 'Vacío')
    then raise exception 'FAIL: the rejected template row was left behind'; end if;
end $$;
\echo '  [9] a plan with no meals cannot be saved as a template'

set request.jwt.claim.sub = '99990000-1111-2222-3333-444455556666';
do $$ begin
  if (select count(*) from plan_template) <> 0 then raise exception 'FAIL: outsider reads templates'; end if;
  if (select count(*) from recipe_stats)  <> 0 then raise exception 'FAIL: recipe_stats leaks past RLS'; end if;
end $$;
\echo '  [10] a non-member sees no templates, and the stats view respects RLS'
