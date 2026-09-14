\set ON_ERROR_STOP on
-- Deleting a plan has to take its meals off the schedule, not merely relabel
-- the plan they hang from.

insert into auth.users (id) values ('7b7b7b7b-7c7c-7d7d-7e7e-7f7f7f7f7f7f');

set role authenticated;
set request.jwt.claim.sub = '7b7b7b7b-7c7c-7d7d-7e7e-7f7f7f7f7f7f';
select id as hh from create_household('Casa Borrar', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Pasta', 'Grains & Pasta', 'g', 'g') returning id as pasta \gset
\o /dev/null
select add_stock(:'pasta', 2000);
\o

insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Pasta con tomate', 'dinner', 2, 'generated') returning id as rec \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'rec', :'pasta', 'Pasta', 400, 'g', 'g');

insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'week', current_date, current_date + 6, 'draft') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'rec', current_date + interval '1 day 20 hours', 'dinner', 2);
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'rec', current_date + interval '2 days 20 hours', 'dinner', 2);

\o /dev/null
select approve_plan(:'plan');
\o
do $$ begin
  if (select count(*) from meal_slot where status in ('planned', 'cooking')) <> 2
    then raise exception 'FAIL: precondition -- two meals should be on the schedule'; end if;
  if (select qty_reserved from product_stock where product_id = (select id from product where name = 'Pasta')) <> 800
    then raise exception 'FAIL: precondition -- both meals should be holding pasta'; end if;
end $$;
\echo '  [1] an approved plan is on the schedule and holding its ingredients'

do $$ begin
  perform cancel_plan((select id from meal_plan where household_id = (select id from household where name = 'Casa Borrar')));

  -- This is the one that was wrong: the plan was marked cancelled and every
  -- meal stayed 'planned', so every reader of the schedule still saw them.
  if exists (
    select 1 from meal_slot ms
     join meal_plan mp on mp.id = ms.plan_id
    where mp.household_id = (select id from household where name = 'Casa Borrar')
      and ms.status in ('planned', 'cooking')
  ) then raise exception 'FAIL: a deleted plan left its meals on the schedule'; end if;
end $$;
\echo '  [2] deleting it takes every meal off the schedule'

do $$ begin
  if (select coalesce(qty_reserved, 0) from product_stock where product_id = (select id from product where name = 'Pasta')) <> 0
    then raise exception 'FAIL: the ingredients were not released'; end if;
  if (select qty_total from product_stock where product_id = (select id from product where name = 'Pasta')) <> 2000
    then raise exception 'FAIL: deleting a plan took food out of the pantry'; end if;
end $$;
\echo '  [3] the ingredients go back, and no stock moves'

-- A meal already cooked is history, and deleting the plan must not rewrite it.
insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'single', current_date, current_date, 'active') returning id as plan2 \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings, status)
values (:'plan2', :'hh', :'rec', current_date + interval '20 hours', 'dinner', 2, 'done')
returning id as done_slot \gset

do $$ begin
  perform cancel_plan((select id from meal_plan where scope = 'single'));
  if (select status from meal_slot where id = (select id from meal_slot where status = 'done' limit 1)) <> 'done'
    then raise exception 'FAIL: a meal already cooked was relabelled'; end if;
end $$;
\echo '  [4] a meal already cooked keeps its place in the record'
