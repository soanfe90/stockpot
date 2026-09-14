\set ON_ERROR_STOP on
-- Shelf life follows the shelf: the same product keeps longer in the freezer
-- than in the fridge, and a date off the packet still overrides all of it.

insert into auth.users (id) values ('9a9a9a9a-9b9b-9c9c-9d9d-9e9e9e9e9e9e');

set role authenticated;
set request.jwt.claim.sub = '9a9a9a9a-9b9b-9c9c-9d9d-9e9e9e9e9e9e';
select id as hh from create_household('Casa Nevera', 2) \gset

do $$ begin
  if shelf_life_days('Produce', 'freezer') <= shelf_life_days('Produce', 'fridge')
    then raise exception 'FAIL: frozen produce should outlast refrigerated produce'; end if;
  if shelf_life_days('Produce', 'fridge') <= shelf_life_days('Produce', 'pantry')
    then raise exception 'FAIL: refrigerated produce should outlast produce left out'; end if;
  -- Frozen food is the one category that gets worse out of the freezer.
  if shelf_life_days('Frozen', 'pantry') >= shelf_life_days('Frozen', 'freezer')
    then raise exception 'FAIL: frozen food left in the cupboard is a today problem'; end if;
  -- A tin does not care.
  if shelf_life_days('Canned & Jarred', 'pantry') <> shelf_life_days('Canned & Jarred', 'freezer')
    then raise exception 'FAIL: a tin keeps the same wherever it is'; end if;
end $$;
\echo '  [1] the catalogue ranks the shelves, per category'

do $$ begin
  -- A life the household typed in is never rewritten on its own shelf.
  if useful_life_days('Produce', 5, 'fridge', 'fridge') <> 5
    then raise exception 'FAIL: the stored life was not respected on its own shelf'; end if;
  -- Elsewhere it scales by how much longer that category keeps there.
  if useful_life_days('Produce', 5, 'fridge', 'freezer') <= 100
    then raise exception 'FAIL: freezing should extend a fridge life substantially'; end if;
  -- "Use it today" stays today wherever it is put.
  if useful_life_days('Produce', 0, 'fridge', 'freezer') <> 0
    then raise exception 'FAIL: a zero-day life must not be stretched'; end if;
  -- And a short life never rounds away to nothing.
  if useful_life_days('Frozen', 100, 'freezer', 'pantry') < 1
    then raise exception 'FAIL: a life must never round down to already-expired'; end if;
end $$;
\echo '  [2] a life somebody typed in travels between shelves, and never to zero'

insert into product (household_id, name, category, base_unit, display_unit, storage, default_useful_life_days)
values (:'hh', 'Guisantes', 'Produce', 'g', 'g', 'fridge', 7) returning id as peas \gset

do $$
declare
  fridge_lot  inventory_lot;
  freezer_lot inventory_lot;
begin
  fridge_lot  := add_stock((select id from product where name = 'Guisantes'), 500, null, current_date, 'fridge');
  freezer_lot := add_stock((select id from product where name = 'Guisantes'), 500, null, current_date, 'freezer');

  if fridge_lot.expires_on <> current_date + 7
    then raise exception 'FAIL: the fridge lot should use the product''s own seven days'; end if;
  if freezer_lot.expires_on <= fridge_lot.expires_on + 30
    then raise exception 'FAIL: the freezer lot expired at % , barely later than the fridge lot at %',
      freezer_lot.expires_on, fridge_lot.expires_on; end if;
  -- Two shelves, two lots: the ledger must not merge them onto one date.
  if fridge_lot.id = freezer_lot.id then raise exception 'FAIL: the two lots were merged'; end if;
end $$;
\echo '  [3] the same bag put in the freezer is dated far beyond the fridge one'

do $$
declare lot inventory_lot;
begin
  lot := add_stock((select id from product where name = 'Guisantes'), 300, current_date + 2, current_date, 'freezer');
  if lot.expires_on <> current_date + 2
    then raise exception 'FAIL: a date given explicitly must win over the shelf'; end if;
end $$;
\echo '  [4] a date off the packet still beats anything inferred'

-- A scanned line with no date used to land on a flat seven days whatever it
-- was; it should now read the category and the shelf.
insert into capture (household_id, kind, status, purchased_on, created_by)
values (:'hh', 'receipt', 'ready', current_date, auth.uid()) returning id as cap \gset
insert into draft_line (capture_id, household_id, position, name, category, qty, display_unit, base_unit, storage, resolution)
values (:'cap', :'hh', 0, 'Merluza', 'Meat & Fish', 500, 'g', 'g', 'freezer', 'new');

\o /dev/null
select commit_capture(:'cap');
\o
do $$
declare prod product;
begin
  select * into prod from product where name = 'Merluza';
  if prod.default_useful_life_days <> shelf_life_days('Meat & Fish', 'freezer')
    then raise exception 'FAIL: a scanned product took % days instead of its category in the freezer',
      prod.default_useful_life_days; end if;
  if (select expires_on from inventory_lot where product_id = prod.id) <= current_date + 30
    then raise exception 'FAIL: frozen fish should not be dated a week out'; end if;
end $$;
\echo '  [5] a scanned line with no date reads its category and its shelf'

-- The scanner does not say where things go, so a line arrives with no shelf.
-- Falling back to the cupboard would date frozen fish at a single day.
insert into capture (household_id, kind, status, purchased_on, created_by)
values (:'hh', 'receipt', 'ready', current_date, auth.uid()) returning id as cap2 \gset
insert into draft_line (capture_id, household_id, position, name, category, qty, display_unit, base_unit, resolution)
values (:'cap2', :'hh', 0, 'Helado', 'Frozen', 500, 'g', 'g', 'new');

\o /dev/null
select commit_capture(:'cap2');
\o
do $$
declare prod product;
begin
  select * into prod from product where name = 'Helado';
  if prod.storage <> 'freezer'
    then raise exception 'FAIL: a frozen line landed in the %', prod.storage; end if;
  if (select expires_on from inventory_lot where product_id = prod.id) <= current_date + 30
    then raise exception 'FAIL: ice cream was dated as if it were left on a shelf'; end if;
end $$;
\echo '  [6] a line with no shelf lands where its category belongs, not the cupboard'
