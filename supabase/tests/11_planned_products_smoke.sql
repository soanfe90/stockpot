\set ON_ERROR_STOP on
-- Products a plan intends to buy: real enough to carry a shortfall onto the
-- shopping list, quiet enough not to look like stock.

insert into auth.users (id) values ('5e5e5e5e-5f5f-5050-5151-525252525252');

set role authenticated;
set request.jwt.claim.sub = '5e5e5e5e-5f5f-5050-5151-525252525252';
select id as hh from create_household('Casa Compra', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit, planned)
values (:'hh', 'Lentejas', 'Grains & Pasta', 'g', 'g', true) returning id as lent \gset
insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Arroz', 'Grains & Pasta', 'g', 'g') returning id as rice \gset
\o /dev/null
select add_stock(:'rice', 1000);
\o

do $$ begin
  -- The rice has stock, so nothing about it needs restocking. The lentils have
  -- none -- but they have never been in the house, so they are not a gap in
  -- what the household keeps, and the list must not invent them on its own.
  if exists (select 1 from needs_restocking((select id from household where name = 'Casa Compra'))
              where product_id = (select id from product where name = 'Lentejas'))
    then raise exception 'FAIL: an intention was treated as a product that ran out'; end if;
end $$;
\echo '  [1] a planned product does not reach the list on its own account'

-- It reaches it through the plan that wants it, like any other shortfall.
insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Lentejas guisadas', 'lunch', 2, 'generated') returning id as rec \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'rec', :'lent', 'Lentejas', 400, 'g', 'g');

insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'week', current_date, current_date + 6, 'draft') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'rec', current_date + interval '4 days 13 hours', 'lunch', 2);

do $$
declare gap record;
begin
  select * into gap from plan_shortfalls((select id from meal_plan limit 1))
   where product_id = (select id from product where name = 'Lentejas');
  if gap.shortfall <> 400
    then raise exception 'FAIL: the whole 400 g should be short, got %', gap.shortfall; end if;
  if gap.needed_by <> current_date + 4
    then raise exception 'FAIL: the deadline should be the day the meal is on, got %', gap.needed_by; end if;
end $$;
\echo '  [2] it shows up as a shortfall, dated by the meal that wants it'

do $$
declare n int;
begin
  n := add_plan_gaps_to_list((select id from meal_plan limit 1));
  if n <> 1 then raise exception 'FAIL: expected one gap on the list, got %', n; end if;
  if (select needed_by from shopping_item where name = 'Lentejas') <> current_date + 4
    then raise exception 'FAIL: the list lost the deadline'; end if;
  if not (select pinned from shopping_item where name = 'Lentejas')
    then raise exception 'FAIL: a plan gap must survive a list refresh'; end if;
end $$;
\echo '  [3] and carries its deadline onto the shopping list, pinned'

\o /dev/null
select refresh_shopping_list((select id from household where name = 'Casa Compra'));
\o
do $$ begin
  if (select needed_by from shopping_item where name = 'Lentejas') <> current_date + 4
    then raise exception 'FAIL: a refresh relabelled the plan gap'; end if;
end $$;
\echo '  [4] a refresh leaves it alone'

-- Buying it is what turns the intention into something the household keeps.
do $$ begin
  perform add_stock((select id from product where name = 'Lentejas'), 500);
  if (select planned from product where name = 'Lentejas')
    then raise exception 'FAIL: it is in the house now and still marked as planned'; end if;
end $$;
\echo '  [5] stock arriving stops it being an intention'

-- And an intention nothing wants any more is cleared out rather than left to
-- collide with the real product next time it is bought.
insert into product (household_id, name, category, base_unit, display_unit, planned)
values (:'hh', 'Quinoa', 'Grains & Pasta', 'g', 'g', true);
do $$
declare n int;
begin
  n := prune_planned_products((select id from household where name = 'Casa Compra'));
  if n <> 1 then raise exception 'FAIL: expected to prune exactly the orphan, pruned %', n; end if;
  if exists (select 1 from product where name = 'Quinoa')
    then raise exception 'FAIL: the orphan survived'; end if;
  -- The one a live plan still wants must not be swept up with it.
  if not exists (select 1 from product where name = 'Lentejas')
    then raise exception 'FAIL: pruning took a product a plan is using'; end if;
end $$;
\echo '  [6] an intention nothing wants any more is pruned, one a plan wants is not'

-- ------------------------------------------- discarding takes it back off ---

do $$ begin
  -- The plan put Lentejas on the list. Cancelling the plan must take it off
  -- again, or every abandoned draft leaves litter someone has to notice.
  if not exists (select 1 from shopping_item where name = 'Lentejas')
    then raise exception 'FAIL: precondition -- the gap should be on the list'; end if;

  perform cancel_plan((select id from meal_plan limit 1));

  if exists (select 1 from shopping_item where name = 'Lentejas' and not checked)
    then raise exception 'FAIL: a discarded plan left its shopping behind'; end if;
end $$;
\echo '  [7] discarding a plan takes its untouched rows back off the list'

-- Something already ticked belongs to whoever ticked it, plan or no plan.
-- A product with no stock at all, so the plan genuinely puts it on the list:
-- by now the lentils have been bought and are no longer short of anything.
insert into product (household_id, name, category, base_unit, display_unit, planned)
values ((select id from household where name = 'Casa Compra'), 'Cúrcuma', 'Condiments & Spices', 'g', 'g', true)
returning id as turmeric \gset
insert into recipe (household_id, name, category, servings, source)
values ((select id from household where name = 'Casa Compra'), 'Curry', 'dinner', 2, 'generated')
returning id as curry \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'curry', :'turmeric', 'Cúrcuma', 20, 'g', 'g');

insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values ((select id from household where name = 'Casa Compra'), 'week', current_date, current_date + 6, 'draft')
returning id as plan2 \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan2', (select id from household where name = 'Casa Compra'), :'curry',
        current_date + interval '4 days 20 hours', 'dinner', 2);

\o /dev/null
select add_plan_gaps_to_list(:'plan2');
\o
do $$ begin
  if not exists (select 1 from shopping_item where name = 'Cúrcuma')
    then raise exception 'FAIL: precondition -- the new gap should be on the list'; end if;
end $$;

update shopping_item set checked = true where name = 'Cúrcuma';

do $$ begin
  perform cancel_plan((select id from meal_plan where status = 'draft' limit 1));
  if not exists (select 1 from shopping_item where name = 'Cúrcuma' and checked)
    then raise exception 'FAIL: a row someone had already ticked was taken away'; end if;
end $$;
\echo '  [8] but a row already ticked is left alone'
