-- Stockpot :: spent lots go when the shelf is restocked
--
-- A lot is a quantity with a date, so a finished packet can never be refilled:
-- what arrives has a different date and becomes a new lot. Nothing ever
-- removed the empty one, so a product bought weekly accumulated a row for
-- every packet it had ever finished, each reading "0 g".
--
-- The ledger was never wrong about this -- product_stock joins on qty > 0, so
-- an empty lot has always counted for nothing in stock, expiry, reservations
-- or cooking. It was only ever a shelf full of ghosts to read past.

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

  if prod.planned then
    update product set planned = false, updated_at = now() where id = p_product_id;
  end if;

  -- Restocking is what retires the empty lots. They cannot be merged into --
  -- the new stock has a different date, which is the whole reason lots exist
  -- -- so without this the shelf collects a row for every packet ever
  -- finished, each showing nothing.
  --
  -- Only ones holding nothing and owed to nobody. The claim is the
  -- reservation row, not the reserved_qty counter: adjust_lot clamps that
  -- counter down to whatever the lot now holds, so a lot corrected to zero
  -- reads as reserving nothing while a meal is still pointing at it. Reading
  -- the counter would delete the lot and cascade that claim away with it --
  -- settling a disagreement by throwing away one side of it.
  delete from inventory_lot l
   where l.product_id = p_product_id
     and l.id <> lot.id
     and l.qty <= 0
     and l.reserved_qty <= 0
     and not exists (select 1 from reservation r where r.lot_id = l.id);

  return lot;
end;
$$;
