-- Stockpot :: shelf life depends on where the food is kept
--
-- Until now a product had one useful life whatever shelf it sat on, so a bag
-- of peas put in the freezer was marked as turning in a week. Expiry is the
-- whole point of this app, and a date that wrong is worse than no date.
--
-- The product still carries a single number, which is its life in the place it
-- usually lives. Putting a lot somewhere else scales that number by how much
-- longer that category keeps there. One stored number, so a life the user
-- corrected by hand is still respected; a category-shaped ratio, so the
-- correction travels sensibly between shelves.

-- Days a category keeps in each place. The value under each category's usual
-- storage is the number Stockpot used before this migration, so nothing that
-- already exists shifts underneath anyone.
create or replace function shelf_life_days(p_category text, p_storage storage_place)
returns int
language sql
immutable
as $$
  select case p_category
    when 'Produce'             then case p_storage when 'pantry' then 4   when 'fridge' then 7   else 240 end
    when 'Meat & Fish'         then case p_storage when 'pantry' then 1   when 'fridge' then 3   else 180 end
    when 'Dairy & Eggs'        then case p_storage when 'pantry' then 2   when 'fridge' then 10  else 90  end
    when 'Bakery'              then case p_storage when 'pantry' then 4   when 'fridge' then 10  else 90  end
    when 'Grains & Pasta'      then case p_storage when 'pantry' then 365 when 'fridge' then 365 else 540 end
    when 'Canned & Jarred'     then case p_storage when 'pantry' then 730 when 'fridge' then 730 else 730 end
    -- Frozen food out of the freezer is a today problem, not a date problem.
    when 'Frozen'              then case p_storage when 'pantry' then 1   when 'fridge' then 2   else 120 end
    when 'Condiments & Spices' then case p_storage when 'pantry' then 365 when 'fridge' then 540 else 540 end
    when 'Snacks'              then case p_storage when 'pantry' then 90  when 'fridge' then 120 else 180 end
    when 'Drinks'              then case p_storage when 'pantry' then 180 when 'fridge' then 240 else 365 end
    else                            case p_storage when 'pantry' then 30  when 'fridge' then 45  else 180 end
  end;
$$;

-- Where a category normally lives. Mirrors NATURAL_STORAGE in the client.
--
-- This matters more than it looks: a scanned line carries no shelf, and once
-- shelf life depends on the shelf, defaulting everything to the cupboard would
-- date frozen fish at a single day. A category is the best guess available.
create or replace function natural_storage(p_category text)
returns storage_place
language sql
immutable
as $$
  select case p_category
    when 'Produce'      then 'fridge'
    when 'Meat & Fish'  then 'fridge'
    when 'Dairy & Eggs' then 'fridge'
    when 'Frozen'       then 'freezer'
    else                     'pantry'
  end::storage_place;
$$;

-- The product's own life, translated to another shelf.
--
-- Same shelf, same number -- a life somebody typed in is never quietly
-- rewritten. A base of zero means "use it today" and stays zero wherever it is
-- put; anything else keeps at least a day, since rounding a short life down to
-- nothing would mark fresh stock as already gone.
create or replace function useful_life_days(
  p_category  text,
  p_base_days int,
  p_usual     storage_place,
  p_storage   storage_place
)
returns int
language sql
immutable
as $$
  select case
    when p_base_days is null or p_base_days <= 0 then coalesce(p_base_days, 0)
    when p_storage = p_usual then p_base_days
    else least(3650, greatest(1, round(
      p_base_days::numeric
      * shelf_life_days(p_category, p_storage)
      / greatest(shelf_life_days(p_category, p_usual), 1)
    )::int))
  end;
$$;

-- add_stock is the only door stock comes through -- manual adds, the capture
-- commit, everything -- so this is the one place the rule has to live.
create or replace function add_stock(
  p_product_id   uuid,
  p_qty          numeric,
  p_expires_on   date default null,
  p_purchased_on date default current_date,
  p_storage      storage_place default null,
  p_unit_price   numeric default null,
  p_reason       movement_reason default 'purchase'
)
returns inventory_lot
language plpgsql
security definer
set search_path = public
as $$
declare
  prod      product;
  lot       inventory_lot;
  v_expires date;
  v_storage storage_place;
begin
  select * into prod from product where id = p_product_id;
  if not found then
    raise exception 'Unknown product' using errcode = 'P0002';
  end if;
  if not is_household_member(prod.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = '22023';
  end if;

  v_storage := coalesce(p_storage, prod.storage);
  -- A date on the packet always wins. Only the inferred one bends to the shelf.
  v_expires := coalesce(
    p_expires_on,
    coalesce(p_purchased_on, current_date)
      + useful_life_days(prod.category, prod.default_useful_life_days, prod.storage, v_storage)
  );

  select * into lot from inventory_lot
   where product_id = p_product_id
     and expires_on is not distinct from v_expires
     and storage = v_storage
   order by created_at
   limit 1
   for update;

  if found then
    update inventory_lot
       set qty        = qty + p_qty,
           unit_price = coalesce(p_unit_price, unit_price)
     where id = lot.id
    returning * into lot;
  else
    insert into inventory_lot (
      household_id, product_id, qty, purchased_on, expires_on, storage, unit_price
    ) values (
      prod.household_id, p_product_id, p_qty,
      coalesce(p_purchased_on, current_date), v_expires, v_storage, p_unit_price
    )
    returning * into lot;
  end if;

  insert into stock_movement (household_id, lot_id, product_id, delta, reason, actor_id)
  values (prod.household_id, lot.id, p_product_id, p_qty, p_reason, auth.uid());

  return lot;
end;
$$;

-- A scanned line that carried no date used to land a new product on a flat
-- seven days whatever it was. Copied from the capture migration with only that
-- one expression changed.
create or replace function commit_capture(p_capture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cap            capture;
  line           draft_line;
  prod           product;
  v_product_id   uuid;
  v_created      int := 0;
  v_committed    int := 0;
  v_skipped      int := 0;
  v_aliases      int := 0;
  v_qty          numeric;
  v_purchased    date;
begin
  select * into cap from capture where id = p_capture_id for update;
  if not found then
    raise exception 'Unknown capture' using errcode = 'P0002';
  end if;
  if not is_household_member(cap.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if cap.status = 'committed' then
    raise exception 'This scan was already added to the inventory' using errcode = '55000';
  end if;

  v_purchased := coalesce(cap.purchased_on, current_date);

  for line in
    select * from draft_line where capture_id = p_capture_id order by position, created_at
  loop
    if line.resolution = 'skip' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Both are loop-scoped; reset so a previous line's product can never
    -- leak into this one's unit check.
    prod := null;
    v_product_id := null;

    if line.resolution = 'merge' and line.matched_product_id is not null then
      select * into prod from product
       where id = line.matched_product_id and household_id = cap.household_id;
      if found then v_product_id := prod.id; end if;
    end if;

    -- A 'new' line whose name already exists merges anyway rather than
    -- failing on the unique index: the user's intent is to add stock.
    if v_product_id is null then
      select * into prod from product
       where household_id = cap.household_id and lower(name) = lower(trim(line.name));
      if found then
        v_product_id := prod.id;
      else
        insert into product (
          household_id, name, category, base_unit, display_unit,
          default_useful_life_days, storage
        ) values (
          cap.household_id, trim(line.name), line.category, line.base_unit, line.display_unit,
          -- A date read off the receipt defines this product's life. Without
          -- one, a flat seven days was wrong for almost everything; the
          -- category and the shelf it is going on know better.
          coalesce(
            nullif(greatest(line.expires_on - v_purchased, 0), 0),
            shelf_life_days(line.category, coalesce(line.storage, natural_storage(line.category)))
          ),
          coalesce(line.storage, natural_storage(line.category))
        )
        returning * into prod;
        v_product_id := prod.id;
        v_created := v_created + 1;
      end if;
    end if;

    -- A line joining an existing product must be measured in something that
    -- can mean the same thing: grams into a product tracked in kilos is fine
    -- (both are grams underneath), "2 ud" into one tracked by weight is not.
    -- Refusing loudly beats writing a quantity that is wrong by 1000x.
    if prod.id is not null and base_of_display_unit(line.display_unit) <> prod.base_unit then
      raise exception
        '"%" is measured in % but % is tracked by %. Fix the unit on that line before adding.',
        line.name, line.display_unit, prod.name, prod.base_unit
        using errcode = '22023';
    end if;

    v_qty := to_base_qty(line.qty, line.display_unit);

    if v_qty > 0 then
      perform add_stock(
        v_product_id, v_qty, line.expires_on, v_purchased,
        coalesce(line.storage, prod.storage), line.unit_price, 'purchase'
      );
    end if;

    -- Alias learning: the till's abbreviation is remembered against the
    -- product it resolved to, so the next scan of the same shop is exact.
    if line.raw_text is not null
       and length(trim(line.raw_text)) > 0
       and lower(trim(line.raw_text)) <> lower(trim(line.name))
    then
      insert into product_alias (household_id, product_id, raw_text, source, hit_count)
      values (cap.household_id, v_product_id, trim(line.raw_text), cap.kind::text, 1)
      on conflict (household_id, lower(raw_text))
        do update set hit_count  = product_alias.hit_count + 1,
                      product_id = excluded.product_id;
      v_aliases := v_aliases + 1;
    end if;

    v_committed := v_committed + 1;
  end loop;

  update capture
     set status = 'committed', committed_at = now()
   where id = p_capture_id;

  return jsonb_build_object(
    'products_created', v_created,
    'lines_committed',  v_committed,
    'lines_skipped',    v_skipped,
    'aliases_learned',  v_aliases
  );
end;
$$;

revoke execute on function natural_storage(text)                                              from public;
revoke execute on function shelf_life_days(text, storage_place)                                from public;
revoke execute on function useful_life_days(text, int, storage_place, storage_place)           from public;
grant  execute on function natural_storage(text)                                              to authenticated;
grant  execute on function shelf_life_days(text, storage_place)                                to authenticated;
grant  execute on function useful_life_days(text, int, storage_place, storage_place)           to authenticated;
