\set ON_ERROR_STOP on
-- Two members of one household, plus an outsider who must see nothing.
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- 1. Alice starts a household -------------------------------------------
select id as hh, invite_code from create_household('Casa Fernandez', 4) \gset
\echo '  [1] household created, invite code:' :'invite_code'

-- 2. Bob joins with the code --------------------------------------------
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select id from join_household(:'invite_code') \gset joined_
do $$ begin
  if (select count(*) from household_member) <> 2 then
    raise exception 'FAIL: expected 2 members, Bob did not join';
  end if;
end $$;
\echo '  [2] second member joined, both see the household'

-- 3. Bob adds a product and two lots with different dates ---------------
insert into product (household_id, name, category, base_unit, display_unit,
                     default_useful_life_days, storage)
values (:'hh', 'Pollo entero', 'Meat & Fish', 'g', 'kg', 3, 'fridge')
returning id as prod \gset

select id from add_stock(:'prod', 100, (current_date + 3)::date) \gset lotA_
select id from add_stock(:'prod', 200, (current_date + 30)::date) \gset lotB_
do $$ begin
  if (select count(*) from inventory_lot) <> 2 then
    raise exception 'FAIL: different expiry dates must not merge into one lot';
  end if;
end $$;
\echo '  [3] two dates -> two lots (not merged)'

-- 4. Adding to a matching date merges instead of opening a third lot -----
select id from add_stock(:'prod', 50, (current_date + 3)::date) \gset lotA2_
do $$ begin
  if (select count(*) from inventory_lot) <> 2 then
    raise exception 'FAIL: same date + storage should merge';
  end if;
  if (select qty from inventory_lot where expires_on = current_date + 3) <> 150 then
    raise exception 'FAIL: merge did not sum quantities';
  end if;
end $$;
\echo '  [4] same date -> merged to 150 g'

-- 5. Expiry inferred from useful life when none is given ----------------
insert into product (household_id, name, category, base_unit, display_unit,
                     default_useful_life_days, storage)
values (:'hh', 'Espinaca fresca', 'Produce', 'g', 'g', 7, 'fridge')
returning id as spinach \gset
select expires_on from add_stock(:'spinach', 200) \gset inferred_
do $$ begin
  if (select expires_on from inventory_lot l join product p on p.id = l.product_id
      where p.name = 'Espinaca fresca') <> current_date + 7 then
    raise exception 'FAIL: expiry was not inferred from useful life';
  end if;
end $$;
\echo '  [5] blank expiry inferred from useful life'

-- 6. The rolled-up view the inventory screen reads -----------------------
do $$
declare r record;
begin
  select * into r from product_stock where product_id = (select id from product where name = 'Pollo entero');
  if r.qty_total <> 350 then raise exception 'FAIL: view total was %, expected 350', r.qty_total; end if;
  if r.next_expiry <> current_date + 3 then raise exception 'FAIL: view next_expiry wrong'; end if;
  if r.lot_count <> 2 then raise exception 'FAIL: view lot_count was %', r.lot_count; end if;
end $$;
\echo '  [6] product_stock rolls up 350 g across 2 lots, soonest date first'

-- 7. Cooking drains the lot closest to expiring, first -------------------
do $$
declare taken numeric; near numeric; far numeric;
begin
  taken := consume_product((select id from product where name = 'Pollo entero'), 200, 'cook');
  select qty into near from inventory_lot where expires_on = current_date + 3;
  select qty into far  from inventory_lot where expires_on = current_date + 30;
  if taken <> 200 then raise exception 'FAIL: consumed % not 200', taken; end if;
  if near <> 0   then raise exception 'FAIL: nearest lot should be emptied first, has %', near; end if;
  if far  <> 150 then raise exception 'FAIL: far lot should be 150, has %', far; end if;
end $$;
\echo '  [7] consume 200 g -> nearest lot emptied first, remainder from the next'

-- 8. A shortfall is reported, not silently swallowed ---------------------
do $$
declare taken numeric;
begin
  taken := consume_product((select id from product where name = 'Pollo entero'), 999, 'cook');
  if taken <> 150 then raise exception 'FAIL: shortfall should return 150, returned %', taken; end if;
  if (select coalesce(sum(qty),0) from inventory_lot
      where product_id = (select id from product where name = 'Pollo entero')) <> 0 then
    raise exception 'FAIL: stock should be exhausted';
  end if;
end $$;
\echo '  [8] over-consumption clamps at zero and reports what it actually took'

-- 9. Corrections are computed server-side from a target ------------------
do $$
declare lot_id uuid;
begin
  select id into lot_id from inventory_lot where expires_on = current_date + 30;
  perform set_lot_quantity(lot_id, 425);
  if (select qty from inventory_lot where id = lot_id) <> 425 then
    raise exception 'FAIL: set_lot_quantity did not reach the target';
  end if;
end $$;
\echo '  [9] set_lot_quantity reaches the target atomically'

-- 10. Every change left an audit row -------------------------------------
do $$
declare n int; net numeric;
begin
  select count(*), sum(delta) into n, net from stock_movement;
  if n < 6 then raise exception 'FAIL: expected a movement per change, found %', n; end if;
  if net <> (select sum(qty) from inventory_lot) then
    raise exception 'FAIL: movements (%) do not reconcile with stock (%)',
      net, (select sum(qty) from inventory_lot);
  end if;
end $$;
\echo '  [10] movement log reconciles exactly with current stock'

-- 11. RLS: an outsider sees nothing at all -------------------------------
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  if (select count(*) from product) <> 0 then raise exception 'FAIL: outsider can read products'; end if;
  if (select count(*) from inventory_lot) <> 0 then raise exception 'FAIL: outsider can read lots'; end if;
  if (select count(*) from household) <> 0 then raise exception 'FAIL: outsider can read households'; end if;
  if (select count(*) from product_stock) <> 0 then raise exception 'FAIL: view leaks past RLS'; end if;
end $$;
\echo '  [11] non-member sees zero rows through every table and the view'

-- 12. RLS: an outsider cannot write into someone else's household --------
\set ON_ERROR_STOP off
insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'smuggled in', 'Other', 'g', 'g');
\set ON_ERROR_STOP on

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if exists (select 1 from product where name = 'smuggled in') then
    raise exception 'FAIL: a non-member write landed in the household';
  end if;
end $$;
\echo '  [12] non-member write refused, nothing landed'

-- 13. A bogus invite code fails cleanly ----------------------------------
do $$ begin
  begin
    perform join_household('ZZZZZZ');
    raise exception 'FAIL: bogus invite code was accepted';
  exception when no_data_found then null;
  end;
end $$;
\echo '  [13] bogus invite code rejected'
