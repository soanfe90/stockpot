\set ON_ERROR_STOP on
-- Swapping one meal of a plan. The interesting case is an approved plan: the
-- claim has to move with the meal, in one piece.

insert into auth.users (id) values ('4d4d4d4d-4e4e-4f4f-4040-414141414141');

set role authenticated;
set request.jwt.claim.sub = '4d4d4d4d-4e4e-4f4f-4040-414141414141';
select id as hh from create_household('Casa Cambio', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Garbanzos', 'Grains & Pasta', 'g', 'g') returning id as chick \gset
\o /dev/null
select add_stock(:'chick', 1000, current_date + 200);
\o

-- Two recipes, both leaning on the same product, so the reservation is
-- unambiguous: whatever is claimed belongs to exactly one of them.
insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Cocido', 'lunch', 2, 'generated') returning id as old_rec \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'old_rec', :'chick', 'Garbanzos', 300, 'g', 'g');

insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Ensalada de garbanzos', 'lunch', 2, 'generated') returning id as new_rec \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'new_rec', :'chick', 'Garbanzos', 200, 'g', 'g');

insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'single', current_date, current_date, 'draft') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'old_rec', current_date + interval '13 hours', 'lunch', 2)
returning id as old_slot \gset

\o /dev/null
select approve_plan(:'plan');
\o
do $$ begin
  if (select qty_reserved from product_stock where product_id = (select id from product where name = 'Garbanzos')) <> 300
    then raise exception 'FAIL: the approved meal did not claim its 300 g'; end if;
end $$;
\echo '  [1] an approved meal is holding its ingredients'

-- The replacement is written first and unreserved, exactly as generate-plan
-- writes it, so the swap is the only step that moves anything.
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'new_rec', current_date + interval '13 hours', 'lunch', 2)
returning id as new_slot \gset

\o /dev/null
select set_config('test.old_slot', :'old_slot', false);
select set_config('test.new_slot', :'new_slot', false);
\o

do $$
declare r jsonb;
begin
  r := swap_slot(current_setting('test.old_slot')::uuid, current_setting('test.new_slot')::uuid);
  if (r->>'shortfall_units')::numeric <> 0
    then raise exception 'FAIL: the replacement went short with 1 kg on the shelf'; end if;
end $$;
\echo '  [2] the swap goes through inside an approved plan'

do $$ begin
  -- 200, not 500: the old meal''s 300 went back before the new one took its share.
  if (select qty_reserved from product_stock where product_id = (select id from product where name = 'Garbanzos')) <> 200
    then raise exception 'FAIL: reserved % g -- the old claim was not released',
      (select qty_reserved from product_stock where product_id = (select id from product where name = 'Garbanzos')); end if;
  if exists (select 1 from reservation where slot_id = current_setting('test.old_slot')::uuid)
    then raise exception 'FAIL: the retired meal is still holding stock'; end if;
  if not exists (select 1 from reservation where slot_id = current_setting('test.new_slot')::uuid)
    then raise exception 'FAIL: the replacement claimed nothing'; end if;
end $$;
\echo '  [3] the claim moved across rather than stacking up'

do $$ begin
  if exists (select 1 from meal_slot where id = current_setting('test.old_slot')::uuid)
    then raise exception 'FAIL: the plan is holding two meals for one sitting'; end if;
  if (select count(*) from meal_slot where plan_id = (select id from meal_plan limit 1)) <> 1
    then raise exception 'FAIL: the plan does not have exactly one lunch'; end if;
  -- A generated recipe with no slot and no cook is clutter in the library.
  if exists (select 1 from recipe where name = 'Cocido')
    then raise exception 'FAIL: the rejected recipe was left in the library'; end if;
end $$;
\echo '  [4] the rejected meal and its recipe are gone'

-- The movement log must still reconcile: a swap moves claims, never stock.
do $$ begin
  if (select qty_total from product_stock where product_id = (select id from product where name = 'Garbanzos')) <> 1000
    then raise exception 'FAIL: swapping a meal changed how much food exists'; end if;
end $$;
\echo '  [5] and no actual stock moved -- a claim is not a deduction'

do $$ begin
  begin
    perform swap_slot(current_setting('test.new_slot')::uuid, current_setting('test.new_slot')::uuid);
    raise exception 'FAIL: a meal was swapped with itself';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
\echo '  [6] a meal cannot be swapped with itself'

\o /dev/null
select start_cooking(current_setting('test.new_slot')::uuid);
\o
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'new_rec', current_date + interval '13 hours', 'lunch', 2)
returning id as spare \gset
\o /dev/null
select set_config('test.spare', :'spare', false);
\o
do $$ begin
  begin
    perform swap_slot(current_setting('test.new_slot')::uuid, current_setting('test.spare')::uuid);
    raise exception 'FAIL: a meal already on the stove was swapped out';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
\echo '  [7] a meal already being cooked is not swappable'
