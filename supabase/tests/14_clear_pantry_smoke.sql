\set ON_ERROR_STOP on
-- Emptying the pantry: the shelves, or the shelves and the catalogue.

insert into auth.users (id) values
  ('8c8c8c8c-8d8d-8e8e-8f8f-808080808080'),
  ('9d9d9d9d-9e9e-9f9f-9090-919191919191');

set role authenticated;
set request.jwt.claim.sub = '8c8c8c8c-8d8d-8e8e-8f8f-808080808080';
select id as hh from create_household('Casa Vacía', 2) \gset

insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Harina', 'Grains & Pasta', 'g', 'g') returning id as flour \gset
insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Azúcar', 'Grains & Pasta', 'g', 'g') returning id as sugar \gset
\o /dev/null
select add_stock(:'flour', 1000);
select add_stock(:'sugar', 500);
\o

-- A live plan holding some of it, which is the case that can corrupt a ledger.
insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Bizcocho', 'snack', 4, 'generated') returning id as cake \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'cake', :'flour', 'Harina', 300, 'g', 'g');
insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'single', current_date, current_date, 'draft') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings)
values (:'plan', :'hh', :'cake', current_date + interval '17 hours', 'snack', 4);
\o /dev/null
select approve_plan(:'plan');
\o

do $$ begin
  if (select qty_reserved from product_stock where product_id = (select id from product where name = 'Harina')) <= 0
    then raise exception 'FAIL: precondition -- the plan should be holding flour'; end if;
end $$;
\echo '  [1] a stocked pantry with a live plan holding some of it'

do $$
declare r jsonb;
begin
  r := clear_pantry((select id from household where name = 'Casa Vacía'));
  if (r->>'plans_cancelled')::int <> 1 then raise exception 'FAIL: the live plan was not cancelled first'; end if;
  if (r->>'lots_removed')::int <> 2 then raise exception 'FAIL: expected two lots gone, got %', r->>'lots_removed'; end if;
end $$;
\echo '  [2] emptying it cancels the plans holding it, then clears the shelves'

do $$ begin
  if exists (select 1 from inventory_lot where household_id = (select id from household where name = 'Casa Vacía'))
    then raise exception 'FAIL: stock survived'; end if;
  if exists (select 1 from reservation) then raise exception 'FAIL: a claim survived the stock it was against'; end if;
  -- The catalogue is what the household buys; emptying the shelves is not
  -- forgetting that they buy flour.
  if (select count(*) from product where household_id = (select id from household where name = 'Casa Vacía')) <> 2
    then raise exception 'FAIL: the catalogue went with the stock'; end if;
  -- And the record of what was bought survives, because lot_id is set null.
  if not exists (select 1 from stock_movement where household_id = (select id from household where name = 'Casa Vacía'))
    then raise exception 'FAIL: the movement history was thrown away with the shelves'; end if;
end $$;
\echo '  [3] the catalogue and the movement history both survive'

do $$
declare r jsonb;
begin
  r := clear_pantry((select id from household where name = 'Casa Vacía'), true);
  if (r->>'products_removed')::int <> 2
    then raise exception 'FAIL: expected both products gone, got %', r->>'products_removed'; end if;
  if exists (select 1 from product where household_id = (select id from household where name = 'Casa Vacía'))
    then raise exception 'FAIL: a product survived'; end if;
end $$;
\echo '  [4] asked to, it takes the catalogue as well'

set request.jwt.claim.sub = '9d9d9d9d-9e9e-9f9f-9090-919191919191';
do $$ begin
  begin
    perform clear_pantry((select id from household where name = 'Casa Vacía'));
    raise exception 'FAIL: an outsider emptied another household''s pantry';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
    if sqlstate <> '42501' then raise exception 'FAIL: expected a membership refusal, got %', sqlstate; end if;
  end;
end $$;
\echo '  [5] and only a member of the household may do it'
