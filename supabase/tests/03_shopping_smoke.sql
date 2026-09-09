\set ON_ERROR_STOP on
-- Phase 3: the list assembles itself from stock, survives being edited mid-trip,
-- and writes back through the ledger when the trip closes.

insert into auth.users (id) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd');

set role authenticated;
set request.jwt.claim.sub = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

select id as hh from create_household('Casa Compra', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit, low_threshold, default_useful_life_days)
values
  (:'hh', 'Leche entera',    'Dairy & Eggs', 'ml', 'L',  500, 5),
  (:'hh', 'Arroz integral',  'Grains & Pasta','g', 'g',  200, 365),
  (:'hh', 'Espinaca fresca', 'Produce',      'g',  'g',    0, 7),
  (:'hh', 'Sal',             'Condiments & Spices','g','g', 0, 3650);

select id as milk    from product where name = 'Leche entera'    \gset
select id as rice    from product where name = 'Arroz integral'  \gset
select id as spinach from product where name = 'Espinaca fresca' \gset
select id as salt    from product where name = 'Sal'             \gset

-- Milk: none. Rice: below threshold. Spinach: fine but turning. Salt: fine.
\o /dev/null
select add_stock(:'rice', 150, current_date + 300);
select add_stock(:'spinach', 200, current_date + 1);
select add_stock(:'salt', 1000, current_date + 3000);
\o

select id as list from refresh_shopping_list(:'hh') \gset

do $$
declare n int;
begin
  select count(*) into n from shopping_item;
  if n <> 3 then raise exception 'FAIL: expected 3 suggestions, got %', n; end if;
  if (select source from shopping_item where product_id = (select id from product where name='Leche entera')) <> 'out_of_stock'
    then raise exception 'FAIL: empty product should read out_of_stock'; end if;
  if (select source from shopping_item where product_id = (select id from product where name='Arroz integral')) <> 'low'
    then raise exception 'FAIL: below-threshold product should read low'; end if;
  if (select source from shopping_item where product_id = (select id from product where name='Espinaca fresca')) <> 'expiring'
    then raise exception 'FAIL: soon-to-turn product should read expiring'; end if;
  if exists (select 1 from shopping_item where product_id = (select id from product where name='Sal'))
    then raise exception 'FAIL: a well-stocked product reached the list'; end if;
end $$;
\echo '  [1] list built itself: out of stock, low, expiring -- and left the salt alone'

do $$ begin
  if (select qty from shopping_item where product_id = (select id from product where name='Leche entera')) <> 500
    then raise exception 'FAIL: with no purchase history, the low threshold should set the suggestion'; end if;
end $$;
\echo '  [2] suggested quantity falls back to the low threshold'

-- Someone edits a row and adds one of their own while shopping.
update shopping_item set qty = 2000, pinned = true
 where product_id = (select id from product where name='Leche entera');
insert into shopping_item (list_id, household_id, name, qty, display_unit, base_unit, category, source)
values (:'list', :'hh', 'Papel de cocina', 2, 'ud', 'unit', 'Other', 'manual');

-- Meanwhile the pantry changes: milk gets restocked, rice too.
\o /dev/null
select add_stock(:'milk', 3000, current_date + 5);
select add_stock(:'rice', 900, current_date + 300);
select refresh_shopping_list(:'hh');
\o

do $$ begin
  if (select qty from shopping_item where product_id = (select id from product where name='Leche entera')) <> 2000
    then raise exception 'FAIL: refresh overwrote a quantity a person had edited'; end if;
  if not exists (select 1 from shopping_item where name = 'Papel de cocina')
    then raise exception 'FAIL: refresh removed a manual row'; end if;
  if exists (select 1 from shopping_item where product_id = (select id from product where name='Arroz integral'))
    then raise exception 'FAIL: a restocked, untouched suggestion should drop off'; end if;
end $$;
\echo '  [3] refresh keeps pinned and manual rows, drops suggestions that no longer apply'

-- The trip: two things found, one not.
update shopping_item set checked = true, purchased_qty = 2000, pinned = true
 where product_id = (select id from product where name='Leche entera');
update shopping_item set checked = true, pinned = true where name = 'Papel de cocina';

do $$
declare s jsonb;
begin
  s := close_purchase((select id from shopping_list where status <> 'closed'), 'Mercadona', 24.80);
  if (s->>'items_added')::int <> 2 then raise exception 'FAIL: added %, expected 2', s->>'items_added'; end if;
  if (s->>'products_created')::int <> 1 then raise exception 'FAIL: the manual row should have created a product'; end if;
  if (s->>'rolled_over')::int <> 1 then raise exception 'FAIL: rolled over %, expected 1', s->>'rolled_over'; end if;
end $$;
\echo '  [4] closing a trip: 2 bought, 1 product created, 1 unfound row rolled over'

do $$
declare total numeric;
begin
  select qty_total into total from product_stock
   where product_id = (select id from product where name='Leche entera');
  -- 3000 already in the fridge plus the 2000 just carried home.
  if total <> 5000 then raise exception 'FAIL: milk is % ml, expected 5000', total; end if;
  if not exists (select 1 from product where name = 'Papel de cocina')
    then raise exception 'FAIL: the manual item did not become a product'; end if;
end $$;
\echo '  [5] purchases landed in stock through add_stock, manual item became a product'

do $$ begin
  if (select count(*) from purchase) <> 1 then raise exception 'FAIL: no purchase was archived'; end if;
  if (select jsonb_array_length(items) from purchase limit 1) <> 2
    then raise exception 'FAIL: the purchase snapshot is the wrong size'; end if;
  if (select total from purchase limit 1) <> 24.80 then raise exception 'FAIL: total not recorded'; end if;
end $$;
\echo '  [6] the trip is archived with its item snapshot and total'

do $$
declare open_lists int;
begin
  select count(*) into open_lists from shopping_list where status <> 'closed';
  if open_lists <> 1 then raise exception 'FAIL: expected exactly 1 open list, found %', open_lists; end if;
  if not exists (select 1 from shopping_item si
                 join shopping_list sl on sl.id = si.list_id
                 where sl.status <> 'closed' and si.product_id = (select id from product where name='Espinaca fresca'))
    then raise exception 'FAIL: the unfound row did not roll onto the new list'; end if;
end $$;
\echo '  [7] exactly one open list, carrying the unfound item forward'

do $$ begin
  begin
    perform close_purchase((select id from shopping_list where status = 'closed' limit 1));
    raise exception 'FAIL: a closed trip was closed again';
  exception when sqlstate '55000' then null;
  end;
end $$;
\echo '  [8] closing an already-closed trip is refused'

-- Units that cannot mean the same thing must not be converted.
insert into shopping_item (list_id, household_id, product_id, name, qty, display_unit, base_unit, category, source, checked)
values ((select id from shopping_list where status <> 'closed'), :'hh', :'milk', 'Leche entera', 2, 'ud', 'unit', 'Dairy & Eggs', 'manual', true);
do $$ begin
  begin
    perform close_purchase((select id from shopping_list where status <> 'closed'));
    raise exception 'FAIL: a unit mismatch was accepted at checkout';
  exception when sqlstate '22023' then null;
  end;
end $$;
\echo '  [9] buying "2 ud" of something tracked by volume is refused'

set request.jwt.claim.sub = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
do $$ begin
  if (select count(*) from shopping_list) <> 0 then raise exception 'FAIL: outsider reads lists'; end if;
  if (select count(*) from shopping_item) <> 0 then raise exception 'FAIL: outsider reads items'; end if;
  if (select count(*) from purchase)      <> 0 then raise exception 'FAIL: outsider reads purchases'; end if;
end $$;
\echo '  [10] a non-member sees no lists, items or purchases'
