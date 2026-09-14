\set ON_ERROR_STOP on
-- Mealtimes on the profile, moving a scheduled meal, and correcting a
-- generated recipe's ingredients while nothing depends on them yet.

insert into auth.users (id) values
  ('7a7a7a7a-7b7b-7c7c-7d7d-7e7e7e7e7e7e'),
  ('8a8a8a8a-8b8b-8c8c-8d8d-8e8e8e8e8e8e');

set role authenticated;
set request.jwt.claim.sub = '7a7a7a7a-7b7b-7c7c-7d7d-7e7e7e7e7e7e';
select id as hh, invite_code from create_household('Casa Horarios', 2) \gset

-- ---------------------------------------------------------- mealtimes -----

do $$
declare p user_profile;
begin
  p := save_preferences();
  if (p.meal_times->>'breakfast')::int <> 480  then raise exception 'FAIL: breakfast should default to 08:00'; end if;
  if (p.meal_times->>'lunch')::int     <> 780  then raise exception 'FAIL: lunch should default to 13:00'; end if;
  if (p.meal_times->>'dinner')::int    <> 1200 then raise exception 'FAIL: dinner should default to 20:00'; end if;
end $$;
\echo '  [1] mealtimes default to 08:00, 13:00 and 20:00'

do $$
declare p user_profile;
begin
  p := save_preferences(null, '{}', '{}', '{}', '{}',
                        '{"breakfast":420,"lunch":840,"dinner":1290,"snack":1020}'::jsonb);
  if (p.meal_times->>'dinner')::int <> 1290 then raise exception 'FAIL: mealtimes not saved'; end if;
  if meal_offset('dinner') <> interval '21 hours 30 minutes'
    then raise exception 'FAIL: meal_offset ignored the saved time'; end if;
end $$;
\echo '  [2] changing them is honoured by meal_offset'

-- Editing diets later must not quietly reset the times to the defaults.
do $$
declare p user_profile;
begin
  p := save_preferences(null, array['Vegan'], '{}', '{}', '{}');
  if (p.meal_times->>'dinner')::int <> 1290
    then raise exception 'FAIL: a diet edit reset the mealtimes'; end if;
end $$;
\echo '  [3] saving other preferences leaves mealtimes untouched'

-- ------------------------------------------------------- rescheduling -----

insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Arroz', 'Grains & Pasta', 'g', 'g') returning id as rice \gset
\o /dev/null
select add_stock(:'rice', 2000);
\o

insert into recipe (household_id, name, category, servings, source)
values (:'hh', 'Arroz con cosas', 'lunch', 2, 'user') returning id as rec \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'rec', :'rice', 'Arroz', 300, 'g', 'g') returning id as ing \gset
insert into recipe_ingredient (recipe_id, product_id, name, qty, display_unit, base_unit)
values (:'rec', null, 'Sal', 5, 'g', 'g') returning id as salt \gset

insert into meal_plan (household_id, scope, starts_on, ends_on, status)
values (:'hh', 'single', current_date, current_date, 'draft') returning id as plan \gset
insert into meal_slot (plan_id, household_id, recipe_id, scheduled_at, category, servings, notify_at)
values (:'plan', :'hh', :'rec', current_date + interval '13 hours', 'lunch', 2,
        current_date + interval '12 hours 30 minutes') returning id as slot \gset

do $$
declare s meal_slot;
begin
  s := reschedule_slot((select ms.id from meal_slot ms join household h on h.id = ms.household_id where h.name = 'Casa Horarios'), current_date + interval '15 hours');
  if extract(hour from s.scheduled_at) <> 15 then raise exception 'FAIL: the meal did not move'; end if;
  -- The reminder is derived, never left pointing at the old time.
  if s.notify_at <> s.scheduled_at - interval '30 minutes'
    then raise exception 'FAIL: the reminder did not move with it'; end if;
end $$;
\echo '  [4] a planned meal moves, and its reminder moves with it'

-- ---------------------------------------------- editing the ingredients ---

do $$
declare line recipe_ingredient;
begin
  line := set_ingredient_qty((select id from recipe_ingredient where recipe_id = (select id from recipe where name = 'Arroz con cosas') and name = 'Arroz'), 450);
  if line.qty <> 450 then raise exception 'FAIL: the quantity was not changed'; end if;
end $$;
\echo '  [5] an ingredient quantity can be corrected on a draft plan'

insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Cebolla', 'Produce', 'unit', 'unit') returning id as onion \gset

do $$
declare line recipe_ingredient;
begin
  line := add_ingredient((select id from recipe where name = 'Arroz con cosas'), (select p.id from product p join household h on h.id = p.household_id where h.name = 'Casa Horarios' and p.name = 'Cebolla'), 2);
  if line.name <> 'Cebolla' then raise exception 'FAIL: the added line did not take the product name'; end if;
  if line.base_unit <> 'unit' then raise exception 'FAIL: the added line did not take the product units'; end if;
end $$;
\echo '  [6] an ingredient can be added, taking its units from the product'

do $$ begin
  begin
    perform add_ingredient((select id from recipe where name = 'Arroz con cosas'), (select p.id from product p join household h on h.id = p.household_id where h.name = 'Casa Horarios' and p.name = 'Cebolla'), 1);
    raise exception 'FAIL: the same product was added twice';
  exception when unique_violation then null;
  end;
end $$;
\echo '  [7] the same product cannot be added to one recipe twice'

do $$ begin
  perform remove_ingredient((select id from recipe_ingredient where recipe_id = (select id from recipe where name = 'Arroz con cosas') and name = 'Sal'));
  if exists (select 1 from recipe_ingredient where id = (select id from recipe_ingredient where recipe_id = (select id from recipe where name = 'Arroz con cosas') and name = 'Sal'))
    then raise exception 'FAIL: the ingredient was not removed'; end if;
end $$;
\echo '  [8] an ingredient can be removed'

-- --------------------------------------------- what editing must refuse ---

-- Approving reserves stock against these quantities, so they stop being
-- editable the moment the plan leaves draft.
\o /dev/null
select approve_plan((select id from meal_plan where household_id = (select id from household where name = 'Casa Horarios')));
\o
do $$ begin
  begin
    perform set_ingredient_qty((select id from recipe_ingredient where recipe_id = (select id from recipe where name = 'Arroz con cosas') and name = 'Arroz'), 100);
    raise exception 'FAIL: an approved plan''s ingredients were edited';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
\echo '  [9] once a plan is approved, its ingredients are locked'

do $$ begin
  begin
    perform reschedule_slot((select ms.id from meal_slot ms join household h on h.id = ms.household_id where h.name = 'Casa Horarios'), current_date + interval '10 hours');
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
    raise exception 'FAIL: an approved meal should still be movable, only a cooking one is fixed';
  end;
end $$;
\echo ' [10] an approved meal can still be moved -- time is not stock'

-- A cooked recipe is a record of what was actually made.
\o /dev/null
select start_cooking((select ms.id from meal_slot ms join household h on h.id = ms.household_id where h.name = 'Casa Horarios'));
select finish_cooking((select ms.id from meal_slot ms join household h on h.id = ms.household_id where h.name = 'Casa Horarios'), null, 5, null);
\o
do $$ begin
  begin
    perform set_ingredient_qty((select id from recipe_ingredient where recipe_id = (select id from recipe where name = 'Arroz con cosas') and name = 'Arroz'), 100);
    raise exception 'FAIL: a cooked recipe was edited instead of forked';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
\echo ' [11] a cooked recipe is never edited, only adapted'

-- ------------------------------------------------------------- tenancy ---

set request.jwt.claim.sub = '8a8a8a8a-8b8b-8c8c-8d8d-8e8e8e8e8e8e';
do $$ begin
  begin
    perform reschedule_slot((select ms.id from meal_slot ms join household h on h.id = ms.household_id where h.name = 'Casa Horarios'), current_date + interval '9 hours');
    raise exception 'FAIL: a non-member moved someone else''s meal';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
\echo ' [12] a non-member cannot move or edit another household''s meals'
