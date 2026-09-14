-- Stockpot :: moving food re-dates it
--
-- Shelf life started depending on the shelf, but only when stock was *added*.
-- Moving something afterwards changed nothing: a bag of peas dragged to the
-- freezer kept the date it was given in the fridge, and a product whose usual
-- place changed kept a useful life that no longer described anywhere.
--
-- Both are the same omission -- a location written without the date that
-- follows from it -- so both go through a function from here on, and neither
-- is a plain update from the client any more.

-- Moving a lot.
--
-- What scales is the life that is *left*, not the life it started with.
-- Freezing arrests decay from the moment it goes in, so a bag with two days
-- left gets the freezer's multiple of two days, not of the seven it was born
-- with. It also runs the other way: thawing that bag gives back a couple of
-- days, which is exactly the warning somebody needs.
--
-- Food already past its date is not rescued by the freezer, and a lot with no
-- date has nothing to re-reckon.
create or replace function move_lot(p_lot_id uuid, p_storage storage_place)
returns inventory_lot
language plpgsql
security definer
set search_path = public
as $$
declare
  lot       inventory_lot;
  prod      product;
  remaining int;
  v_expires date;
begin
  select * into lot from inventory_lot where id = p_lot_id for update;
  if not found then
    raise exception 'Unknown lot' using errcode = 'P0002';
  end if;
  if not is_household_member(lot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if lot.storage = p_storage then
    return lot;
  end if;

  select * into prod from product where id = lot.product_id;

  v_expires := lot.expires_on;
  if v_expires is not null then
    remaining := v_expires - current_date;
    if remaining > 0 then
      v_expires := current_date + least(3650, greatest(1, round(
        remaining::numeric
        * shelf_life_days(prod.category, p_storage)
        / greatest(shelf_life_days(prod.category, lot.storage), 1)
      )::int));
    end if;
  end if;

  update inventory_lot
     set storage = p_storage, expires_on = v_expires
   where id = p_lot_id
  returning * into lot;

  return lot;
end;
$$;

-- Changing where a product usually lives.
--
-- default_useful_life_days means "how long this keeps in product.storage", so
-- moving that shelf without translating the number leaves it describing
-- nowhere. Existing lots are untouched: they have shelves of their own, and
-- move_lot is how those change.
create or replace function set_product_storage(p_product_id uuid, p_storage storage_place)
returns product
language plpgsql
security definer
set search_path = public
as $$
declare prod product;
begin
  select * into prod from product where id = p_product_id for update;
  if not found then
    raise exception 'Unknown product' using errcode = 'P0002';
  end if;
  if not is_household_member(prod.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if prod.storage = p_storage then
    return prod;
  end if;

  update product
     set storage = p_storage,
         default_useful_life_days =
           useful_life_days(prod.category, prod.default_useful_life_days, prod.storage, p_storage),
         updated_at = now()
   where id = p_product_id
  returning * into prod;

  return prod;
end;
$$;

revoke execute on function move_lot(uuid, storage_place)             from public;
revoke execute on function set_product_storage(uuid, storage_place)  from public;
grant  execute on function move_lot(uuid, storage_place)             to authenticated;
grant  execute on function set_product_storage(uuid, storage_place)  to authenticated;
