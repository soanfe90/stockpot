\set ON_ERROR_STOP on
-- A finished packet cannot be refilled -- what arrives has a different date --
-- so restocking is what has to retire the empty one.

insert into auth.users (id) values ('0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9');

set role authenticated;
set request.jwt.claim.sub = '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9';
select id as hh from create_household('Casa Lotes', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit, storage)
values (:'hh', 'Leche', 'Dairy & Eggs', 'ml', 'l', 'fridge') returning id as milk \gset

\o /dev/null
select add_stock(:'milk', 2000, current_date + 5);
\o
do $$ begin
  -- Drink all of it.
  perform consume_product((select id from product where name = 'Leche'), 2000, 'cook');
  if (select qty from inventory_lot where product_id = (select id from product where name = 'Leche')) <> 0
    then raise exception 'FAIL: precondition -- the lot should be empty'; end if;
  if (select qty_total from product_stock where product_id = (select id from product where name = 'Leche')) <> 0
    then raise exception 'FAIL: an empty lot is still counted as stock'; end if;
end $$;
\echo '  [1] a drained lot counts for nothing, but is still on the shelf'

do $$
declare fresh inventory_lot;
begin
  fresh := add_stock((select id from product where name = 'Leche'), 1000, current_date + 12);

  -- The new milk keeps its own date rather than merging into the old carton.
  if fresh.expires_on <> current_date + 12
    then raise exception 'FAIL: the new stock took the old lot''s date'; end if;
  if (select count(*) from inventory_lot where product_id = (select id from product where name = 'Leche')) <> 1
    then raise exception 'FAIL: the empty lot survived a restock'; end if;
  if (select qty_total from product_stock where product_id = (select id from product where name = 'Leche')) <> 1000
    then raise exception 'FAIL: stock is wrong after restocking'; end if;
end $$;
\echo '  [2] restocking makes a new lot and retires the empty one'

do $$ begin
  -- What was bought and drunk is still on record: stock_movement.lot_id is
  -- ON DELETE SET NULL, so retiring the carton does not rewrite history.
  if (select count(*) from stock_movement where product_id = (select id from product where name = 'Leche')) < 3
    then raise exception 'FAIL: the movement history went with the lot'; end if;
end $$;
\echo '  [3] and the movement history survives it'

-- A lot emptied while a meal still has a claim on it is a disagreement, not a
-- spent packet, and must not be quietly swept away.
insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Café con leche', 'breakfast', 1, 'user') returning id as rec \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'rec', :'milk', 'Leche', 200, 'ml', 'ml');
insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'single', current_date, current_date, 'draft') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'rec', current_date + interval '8 hours', 'breakfast', 1);
\o /dev/null
select approve_plan(:'plan');
\o

do $$
declare held uuid;
begin
  select lot_id into held from reservation limit 1;
  -- Somebody corrects the carton to empty while the plan still claims 200 ml.
  perform set_lot_quantity(held, 0);
  perform add_stock((select id from product where name = 'Leche'), 500, current_date + 20);

  if not exists (select 1 from inventory_lot where id = held)
    then raise exception 'FAIL: a lot still owed to a meal was swept away'; end if;
end $$;
\echo '  [4] one still owed to a meal is left alone'
