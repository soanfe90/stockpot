\set ON_ERROR_STOP on
-- Phase 4: approving a plan claims stock, cooking releases the claim and
-- deducts what was actually used, and the pantry reconciles at every step.

insert into auth.users (id) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff');

set role authenticated;
set request.jwt.claim.sub = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

select id as hh from create_household('Casa Cocina', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit, default_useful_life_days)
values (:'hh', 'Pollo', 'Meat & Fish',    'g', 'kg', 4),
       (:'hh', 'Arroz', 'Grains & Pasta', 'g', 'g',  365);
select id as chicken from product where name = 'Pollo' \gset
select id as rice    from product where name = 'Arroz' \gset

\o /dev/null
select add_stock(:'chicken', 2000, current_date + 10);
select add_stock(:'rice',     400, current_date + 300);
\o

-- A recipe for two: 500 g chicken, 200 g rice, and salt the app does not track.
insert into recipe (household_id, name, category, cuisine, servings, est_minutes, total_calories, source)
values (:'hh', 'Arroz con pollo', 'dinner', 'Latino', 2, 40, 620, 'generated')
returning id as rcp \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit, optional, position)
values (:'rcp', :'chicken', 'Pollo', 500, 'g', 'g', false, 0),
       (:'rcp', :'rice',   'Arroz', 200, 'g', 'g', false, 1),
       (:'rcp', null,      'Sal',     5, 'g', 'g', false, 2);

insert into meal_plan (household_id, scope, starts_on, ends_on)
values (:'hh', 'day', current_date, current_date) returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings, position)
values (:'plan', :'hh', :'rcp', current_date + interval '13 hours', 'lunch',  2, 0),
       (:'plan', :'hh', :'rcp', current_date + interval '20 hours', 'dinner', 4, 1);
select id as slot_a from meal_slot where servings = 2 \gset
select id as slot_b from meal_slot where servings = 4 \gset

\echo '  [1] a day plan staged: the same recipe for two, then for four'

-- 500 + 1000 chicken, 200 + 400 rice, against 2000 g and 400 g on hand.
do $$
declare short numeric;
begin
  select shortfall into short from plan_shortfalls((select id from meal_plan)) where product_name = 'Arroz';
  if short <> 200 then raise exception 'FAIL: rice shortfall is %, expected 200', short; end if;
  if (select shortfall from plan_shortfalls((select id from meal_plan)) where product_name = 'Pollo') <> 0
    then raise exception 'FAIL: there is enough chicken; no shortfall expected'; end if;
end $$;
\echo '  [2] shortfall computed per product, scaled by each slot''s servings'

do $$
declare r jsonb;
begin
  r := approve_plan((select id from meal_plan));
  if (r->>'shortfall_units')::numeric <> 200 then
    raise exception 'FAIL: approval reported % short, expected 200', r->>'shortfall_units';
  end if;
end $$;
\echo '  [3] approving claims what it can and reports the rest, rather than failing'

do $$ begin
  if (select qty_reserved from product_stock where product_id = (select id from product where name='Pollo')) <> 1500
    then raise exception 'FAIL: chicken reservation is wrong'; end if;
  -- Only 400 g of rice exists, so only 400 can be claimed.
  if (select qty_reserved from product_stock where product_id = (select id from product where name='Arroz')) <> 400
    then raise exception 'FAIL: rice reservation should be capped by what exists'; end if;
  if (select count(*) from reservation) < 3 then raise exception 'FAIL: reservations were not recorded per slot'; end if;
end $$;
\echo '  [4] reservations claim only free stock, never more than exists'

do $$
declare n int;
begin
  n := add_plan_gaps_to_list((select id from meal_plan));
  if n <> 1 then raise exception 'FAIL: expected 1 gap on the list, got %', n; end if;
  if (select qty from shopping_item where source = 'recipe_gap') <> 200
    then raise exception 'FAIL: the gap should be the 200 g actually missing'; end if;
  if not (select pinned from shopping_item where source = 'recipe_gap')
    then raise exception 'FAIL: a plan gap must be pinned against list refresh'; end if;
end $$;
\echo '  [5] the gap went to the shopping list, pinned so refresh cannot relabel it'

\o /dev/null
select refresh_shopping_list(:'hh');
\o
do $$ begin
  if (select count(*) from shopping_item where source = 'recipe_gap') <> 1
    then raise exception 'FAIL: refresh removed or relabelled the plan gap'; end if;
end $$;
\echo '  [6] a list refresh leaves the plan gap alone'

-- Cooking the first meal, exactly as planned.
\o /dev/null
select start_cooking(:'slot_a');
\o
do $$
declare r jsonb;
begin
  r := finish_cooking((select ms.id from meal_slot ms join meal_plan mp on mp.id = ms.plan_id where mp.scope = 'day' and ms.servings = 2), 2);
  if jsonb_array_length(r->'deductions') <> 2 then
    raise exception 'FAIL: expected 2 tracked deductions, got %', jsonb_array_length(r->'deductions');
  end if;
end $$;
\echo '  [7] finishing deducts only tracked ingredients -- the salt is not stock'

do $$
declare chicken numeric; rice numeric;
begin
  select qty_total into chicken from product_stock where product_id = (select id from product where name='Pollo');
  select qty_total into rice    from product_stock where product_id = (select id from product where name='Arroz');
  if chicken <> 1500 then raise exception 'FAIL: chicken is % g, expected 1500', chicken; end if;
  if rice    <> 200  then raise exception 'FAIL: rice is % g, expected 200', rice; end if;
end $$;
\echo '  [8] stock fell by exactly what the recipe called for at those servings'

do $$
declare res numeric;
begin
  -- Slot A's claim is gone; slot B's 1000 g of chicken remains.
  select qty_reserved into res from product_stock where product_id = (select id from product where name='Pollo');
  if res <> 1000 then raise exception 'FAIL: chicken still reserved is %, expected 1000', res; end if;
  if exists (select 1 from reservation where slot_id = (select ms.id from meal_slot ms join meal_plan mp on mp.id = ms.plan_id where mp.scope = 'day' and ms.servings = 2))
    then raise exception 'FAIL: the cooked slot kept its reservations'; end if;
  if (select status from meal_slot where id = (select ms.id from meal_slot ms join meal_plan mp on mp.id = ms.plan_id where mp.scope = 'day' and ms.servings = 2)) <> 'done'
    then raise exception 'FAIL: the slot was not marked done'; end if;
end $$;
\echo '  [9] cooking released that slot''s claim and left the other slot''s intact'

-- The second meal: cooked for four, but only 900 g of chicken went in.
do $$
declare r jsonb; adj jsonb;
begin
  adj := jsonb_build_object((select id from product where name='Pollo')::text, 900);
  perform start_cooking((select ms.id from meal_slot ms join meal_plan mp on mp.id = ms.plan_id where mp.scope = 'day' and ms.servings = 4));
  r := finish_cooking((select ms.id from meal_slot ms join meal_plan mp on mp.id = ms.plan_id where mp.scope = 'day' and ms.servings = 4), 4, 5, 'Salió buenísimo', null, adj);
  if (select qty_total from product_stock where product_id = (select id from product where name='Pollo')) <> 600
    then raise exception 'FAIL: an adjusted amount was not honoured'; end if;
end $$;
\echo '  [10] an adjusted amount overrides the recipe -- people do not cook to spec'

do $$
declare taken numeric;
begin
  -- Only 200 g of rice was left but 400 was wanted; the log records both.
  select (d->>'taken')::numeric into taken
    from cook_log cl, jsonb_array_elements(cl.deductions) d
   where d->>'name' = 'Arroz' and cl.actual_servings = 4;
  if taken <> 200 then raise exception 'FAIL: shortfall not recorded honestly, took %', taken; end if;
  if (select qty_total from product_stock where product_id = (select id from product where name='Arroz')) <> 0
    then raise exception 'FAIL: rice should be exhausted, not negative'; end if;
end $$;
\echo '  [11] cooking past available stock clamps at zero and logs what was really used'

do $$ begin
  if (select status from meal_plan limit 1) <> 'done'
    then raise exception 'FAIL: a plan with every slot cooked should be done'; end if;
  if (select count(*) from cook_log) <> 2 then raise exception 'FAIL: expected 2 cook logs'; end if;
  if (select rating from cook_log where actual_servings = 4) <> 5
    then raise exception 'FAIL: the rating was not saved'; end if;
end $$;
\echo '  [12] the plan closed itself once nothing was left to cook'

do $$ begin
  begin
    perform finish_cooking((select ms.id from meal_slot ms join meal_plan mp on mp.id = ms.plan_id where mp.scope = 'day' and ms.servings = 2));
    raise exception 'FAIL: a finished meal was finished twice';
  exception when sqlstate '55000' then null;
  end;
end $$;
\echo '  [13] finishing the same meal twice is refused'

-- Cancelling an unapproved-then-approved plan must give the stock back.
insert into meal_plan (household_id, scope, starts_on, ends_on)
values (:'hh', 'single', current_date, current_date) returning id as plan2 \gset
\o /dev/null
select add_stock(:'chicken', 1000, current_date + 10);
\o
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan2', :'hh', :'rcp', current_date + interval '1 day 20 hours', 'dinner', 2);
do $$
declare before_reserved numeric; after_reserved numeric;
begin
  perform approve_plan((select id from meal_plan where scope = 'single'));
  select qty_reserved into before_reserved from product_stock
   where product_id = (select id from product where name='Pollo');
  if before_reserved <> 500 then raise exception 'FAIL: expected 500 g claimed, got %', before_reserved; end if;

  perform cancel_plan((select id from meal_plan where scope = 'single'));
  select qty_reserved into after_reserved from product_stock
   where product_id = (select id from product where name='Pollo');
  if after_reserved <> 0 then raise exception 'FAIL: cancelling left % g claimed', after_reserved; end if;
end $$;
\echo '  [14] cancelling a plan gives every reservation back'

do $$
declare movements numeric; stock numeric;
begin
  select sum(delta) into movements from stock_movement;
  select sum(qty)   into stock     from inventory_lot;
  if movements <> stock then
    raise exception 'FAIL: movements (%) do not reconcile with stock (%)', movements, stock;
  end if;
  if exists (select 1 from inventory_lot where reserved_qty > qty)
    then raise exception 'FAIL: a lot is reserved beyond what it holds'; end if;
end $$;
\echo '  [15] after all of it, the movement log still reconciles exactly with stock'

set request.jwt.claim.sub = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
do $$ begin
  if (select count(*) from meal_plan)   <> 0 then raise exception 'FAIL: outsider reads plans'; end if;
  if (select count(*) from recipe)      <> 0 then raise exception 'FAIL: outsider reads recipes'; end if;
  if (select count(*) from cook_log)    <> 0 then raise exception 'FAIL: outsider reads cook logs'; end if;
  if (select count(*) from reservation) <> 0 then raise exception 'FAIL: outsider reads reservations'; end if;
end $$;
\echo '  [16] a non-member sees no plans, recipes, logs or reservations'

-- Skipping must give stock back the same way cancelling does.
set request.jwt.claim.sub = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
insert into meal_plan (household_id, scope, starts_on, ends_on)
values (:'hh', 'single', current_date, current_date) returning id as plan3 \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan3', :'hh', :'rcp', current_date + interval '2 days 13 hours', 'lunch', 2);
do $$
declare claimed numeric;
begin
  perform approve_plan((select id from meal_plan where scope = 'single' and status = 'draft'));
  select qty_reserved into claimed from product_stock where product_id = (select id from product where name='Pollo');
  if claimed <> 500 then raise exception 'FAIL: expected 500 g claimed before skipping, got %', claimed; end if;

  perform skip_meal((select ms.id from meal_slot ms join meal_plan mp on mp.id = ms.plan_id
                     where mp.status = 'active' and ms.status = 'planned' limit 1));
  select qty_reserved into claimed from product_stock where product_id = (select id from product where name='Pollo');
  if claimed <> 0 then raise exception 'FAIL: skipping left % g claimed', claimed; end if;
  if (select count(*) from reservation) <> 0 then raise exception 'FAIL: skipping left reservation rows'; end if;
end $$;
\echo '  [17] skipping a meal gives its reservation back'
