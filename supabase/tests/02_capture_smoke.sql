\set ON_ERROR_STOP on
-- Phase 2: a reviewed draft tray becomes stock, through the same ledger the
-- manual path uses -- and refuses to write a quantity it cannot trust.

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select id as hh from create_household('Casa Capture', 3) \gset

-- An existing product, tracked in litres, plus a learned till abbreviation.
insert into product (household_id, name, category, base_unit, display_unit,
                     default_useful_life_days, storage)
values (:'hh', 'Leche entera', 'Dairy & Eggs', 'ml', 'L', 5, 'fridge')
returning id as milk \gset
insert into product_alias (household_id, product_id, raw_text)
values (:'hh', :'milk', 'LCH ENT 1L');

insert into capture (household_id, kind, image_path, status, store, purchased_on)
values (:'hh', 'receipt', :'hh' || '/x.jpg', 'ready', 'Mercadona', current_date)
returning id as cap \gset

insert into draft_line (capture_id, household_id, raw_text, name, qty, display_unit,
                        base_unit, category, matched_product_id, confidence, resolution, position)
values
  (:'cap', :'hh', 'LCH ENT 1L',   'Leche entera',  2,   'L',  'ml',   'Dairy & Eggs', :'milk', 0.95, 'merge', 0),
  (:'cap', :'hh', 'PLLO ENT KG',  'Pollo entero',  1.5, 'kg', 'g',    'Meat & Fish',  null,    0.80, 'new',   1),
  (:'cap', :'hh', 'BOLSA PLAST',  'Bolsa',         1,   'ud', 'unit', 'Other',        null,    0.99, 'skip',  2),
  (:'cap', :'hh', 'LECHE E. 1L',  'leche ENTERA',  1,   'L',  'ml',   'Dairy & Eggs', null,    0.60, 'new',   3);

\echo '  [1] tray staged: one merge, one new, one skip, one name-collision'

do $$
declare s jsonb;
begin
  s := commit_capture((select id from capture limit 1));
  if (s->>'lines_committed')::int <> 3 then raise exception 'FAIL: committed %, expected 3', s->>'lines_committed'; end if;
  if (s->>'lines_skipped')::int   <> 1 then raise exception 'FAIL: skipped %, expected 1', s->>'lines_skipped'; end if;
  if (s->>'products_created')::int <> 1 then raise exception 'FAIL: created %, expected 1', s->>'products_created'; end if;
end $$;
\echo '  [2] commit summary: 3 committed, 1 skipped, 1 product created'

-- 2 L + 1 L into a product tracked in millilitres.
do $$
declare total numeric;
begin
  select qty_total into total from product_stock
   where product_id = (select id from product where name = 'Leche entera');
  if total <> 3000 then raise exception 'FAIL: milk is % ml, expected 3000', total; end if;
end $$;
\echo '  [3] litres converted to millilitres; the case-different line merged, not duplicated'

do $$
declare p product; total numeric;
begin
  select * into p from product where name = 'Pollo entero';
  if not found then raise exception 'FAIL: new product was not created'; end if;
  if p.base_unit <> 'g' then raise exception 'FAIL: base unit is %, expected g', p.base_unit; end if;
  select qty_total into total from product_stock where product_id = p.id;
  if total <> 1500 then raise exception 'FAIL: chicken is % g, expected 1500', total; end if;
end $$;
\echo '  [4] 1.5 kg stored as 1500 g under a newly created product'

do $$ begin
  if exists (select 1 from product where name = 'Bolsa') then
    raise exception 'FAIL: a skipped line created a product';
  end if;
end $$;
\echo '  [5] the skipped bag never reached the inventory'

-- Alias learning: the till strings are now attached to their products.
do $$
declare n int;
begin
  select count(*) into n from product_alias where raw_text in ('PLLO ENT KG', 'LECHE E. 1L');
  if n <> 2 then raise exception 'FAIL: expected 2 new aliases, found %', n; end if;
  if (select hit_count from product_alias where raw_text = 'LCH ENT 1L') <> 1 then
    raise exception 'FAIL: an existing alias should have its hit_count bumped';
  end if;
end $$;
\echo '  [6] till abbreviations learned; the known one had its hit count bumped'

do $$ begin
  if (select status from capture limit 1) <> 'committed' then raise exception 'FAIL: capture not marked committed'; end if;
end $$;

do $$ begin
  begin
    perform commit_capture((select id from capture limit 1));
    raise exception 'FAIL: the same tray was committed twice';
  exception when sqlstate '55000' then null;
  end;
end $$;
\echo '  [7] committing the same tray twice is refused'

-- A unit that cannot mean the same thing as the product's must not be
-- silently converted -- that is how stock ends up wrong by 1000x.
insert into capture (household_id, kind, status, purchased_on)
values (:'hh', 'receipt', 'ready', current_date) returning id as cap2 \gset
insert into draft_line (capture_id, household_id, name, qty, display_unit, base_unit,
                        category, matched_product_id, resolution, position)
values (:'cap2', :'hh', 'Leche entera', 2, 'ud', 'unit', 'Dairy & Eggs', :'milk', 'merge', 0);

do $$ begin
  begin
    perform commit_capture((select id from capture where status <> 'committed' limit 1));
    raise exception 'FAIL: a unit mismatch was accepted';
  exception when sqlstate '22023' then null;
  end;
end $$;
\echo '  [8] merging "2 ud" into a product tracked by volume is refused'

do $$ begin
  if (select qty_total from product_stock where product_id = (select id from product where name = 'Leche entera')) <> 3000 then
    raise exception 'FAIL: the refused commit still changed stock';
  end if;
end $$;
\echo '  [9] the refused commit left stock untouched'

-- RLS
set request.jwt.claim.sub = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
do $$ begin
  if (select count(*) from capture) <> 0 then raise exception 'FAIL: outsider reads captures'; end if;
  if (select count(*) from draft_line) <> 0 then raise exception 'FAIL: outsider reads draft lines'; end if;
end $$;
\echo '  [10] a non-member sees no captures and no draft lines'
