\set ON_ERROR_STOP on
-- Being away is not the same as giving up: the meals move, and the food stays
-- spoken for by them throughout.

insert into auth.users (id) values ('1e2f3a4b-5c6d-7e8f-9a0b-1c2d3e4f5a6b');

set role authenticated;
set request.jwt.claim.sub = '1e2f3a4b-5c6d-7e8f-9a0b-1c2d3e4f5a6b';
select id as hh from create_household('Casa Viaje', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Arroz', 'Grains & Pasta', 'g', 'g') returning id as rice \gset
\o /dev/null
select add_stock(:'rice', 3000, current_date + 60);
\o

insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Arroz al horno', 'dinner', 2, 'generated') returning id as rec \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'rec', :'rice', 'Arroz', 300, 'g', 'g');

insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'week', current_date, current_date + 3, 'draft') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'rec', current_date + interval '20 hours', 'dinner', 2),
       (:'plan', :'hh', :'rec', current_date + interval '1 day 20 hours', 'dinner', 2),
       (:'plan', :'hh', :'rec', current_date + interval '3 days 20 hours', 'dinner', 2);
\o /dev/null
select approve_plan(:'plan');
\o

do $$ begin
  if (select qty_reserved from product_stock where product_id = (select id from product where name = 'Arroz')) <> 900
    then raise exception 'FAIL: precondition -- three meals should be holding 900 g'; end if;
end $$;
\echo '  [1] three dinners across a week, each holding its rice'

-- The first is already cooked, so it belongs to a day that really happened.
\o /dev/null
select start_cooking(id) from meal_slot
 where plan_id = (select id from meal_plan where household_id = (select id from household where name = 'Casa Viaje'))
 order by scheduled_at limit 1;
\o

do $$
declare moved int;
begin
  moved := shift_plan(
    (select id from meal_plan where household_id = (select id from household where name = 'Casa Viaje')),
    current_date, 2);
  -- Two moved: the one on the stove is happening now and does not travel.
  if moved <> 2 then raise exception 'FAIL: expected 2 meals moved, got %', moved; end if;
end $$;
\echo '  [2] the meals not yet started move back two days'

do $$ begin
  if (select count(*) from meal_slot
       where plan_id = (select id from meal_plan where household_id = (select id from household where name = 'Casa Viaje'))
         and status = 'planned'
         and scheduled_at::date = current_date + 3) <> 1
    then raise exception 'FAIL: the day-1 dinner should now be on day 3'; end if;
  if (select count(*) from meal_slot
       where plan_id = (select id from meal_plan where household_id = (select id from household where name = 'Casa Viaje'))
         and status = 'planned'
         and scheduled_at::date = current_date + 5) <> 1
    then raise exception 'FAIL: the day-3 dinner should now be on day 5'; end if;
  -- The reminder travels with the meal, or it fires for a day nobody is cooking.
  if exists (
    select 1 from meal_slot
     where plan_id = (select id from meal_plan where household_id = (select id from household where name = 'Casa Viaje'))
       and status = 'planned'
       and notify_at <> scheduled_at - interval '30 minutes')
    then raise exception 'FAIL: a reminder was left behind'; end if;
end $$;
\echo '  [3] keeping their order, their times and their reminders'

do $$ begin
  -- This is the whole point: nothing was skipped, so nothing was released.
  if (select qty_reserved from product_stock where product_id = (select id from product where name = 'Arroz')) <> 900
    then raise exception 'FAIL: moving a plan released its ingredients'; end if;
  if (select ends_on from meal_plan where household_id = (select id from household where name = 'Casa Viaje'))
     < current_date + 5
    then raise exception 'FAIL: the plan still claims to end before its last meal'; end if;
end $$;
\echo '  [4] the food stays spoken for, and the plan now spans its meals'

do $$
declare moved int;
begin
  -- A meal already underway is not moved, so a plan of only those moves nothing.
  moved := shift_plan(
    (select id from meal_plan where household_id = (select id from household where name = 'Casa Viaje')),
    current_date + 30, 2);
  if moved <> 0 then raise exception 'FAIL: nothing on or after that date, yet % moved', moved; end if;
end $$;
\echo '  [5] shifting from a date with nothing after it moves nothing'
