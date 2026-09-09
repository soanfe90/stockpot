-- Stockpot :: ledger functions
--
-- Rule for the whole app: the client never sends an absolute quantity for
-- stock it did not just read atomically. Every change is a delta or a
-- server-computed target applied under a row lock, so two members cooking or
-- shopping at the same time cannot lose each other's writes.

-- Unambiguous alphabet: no I, O, 0 or 1 to read aloud across a kitchen.
create or replace function generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from household where invite_code = code);
  end loop;
  return code;
end;
$$;

-- ------------------------------------------------------- joining in ------

create or replace function create_household(p_name text, p_size int default 2)
returns household
language plpgsql
security definer
set search_path = public
as $$
declare h household;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  insert into household (name, invite_code, size)
  values (trim(p_name), generate_invite_code(), coalesce(p_size, 2))
  returning * into h;

  insert into household_member (household_id, user_id, role)
  values (h.id, auth.uid(), 'owner');

  insert into user_profile (user_id) values (auth.uid())
  on conflict (user_id) do nothing;

  return h;
end;
$$;

create or replace function join_household(p_invite_code text)
returns household
language plpgsql
security definer
set search_path = public
as $$
declare h household;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select * into h from household
  where invite_code = upper(trim(p_invite_code));

  if not found then
    raise exception 'That invite code does not match any household'
      using errcode = 'P0002';
  end if;

  insert into household_member (household_id, user_id)
  values (h.id, auth.uid())
  on conflict (household_id, user_id) do nothing;

  insert into user_profile (user_id) values (auth.uid())
  on conflict (user_id) do nothing;

  return h;
end;
$$;

-- ------------------------------------------------------- adding stock ----

-- Merges into an existing lot only when the date AND the storage place match;
-- otherwise a new lot is opened. Expiry is inferred from the product's useful
-- life when the caller does not supply one -- never left blank, because a
-- null date opts the item out of the entire expiry engine.
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
  v_expires := coalesce(
    p_expires_on,
    coalesce(p_purchased_on, current_date) + prod.default_useful_life_days
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

-- ---------------------------------------------------- changing stock -----

-- Atomic relative change. Clamps at zero and records what was actually
-- applied, not what was asked for.
create or replace function adjust_lot(
  p_lot_id uuid,
  p_delta  numeric,
  p_reason movement_reason default 'correction',
  p_ref    uuid default null
)
returns inventory_lot
language plpgsql
security definer
set search_path = public
as $$
declare
  lot     inventory_lot;
  applied numeric;
begin
  select * into lot from inventory_lot where id = p_lot_id for update;
  if not found then
    raise exception 'Unknown lot' using errcode = 'P0002';
  end if;
  if not is_household_member(lot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  applied := greatest(lot.qty + p_delta, 0) - lot.qty;

  update inventory_lot
     set qty          = lot.qty + applied,
         reserved_qty = least(reserved_qty, lot.qty + applied)
   where id = lot.id
  returning * into lot;

  if applied <> 0 then
    insert into stock_movement (household_id, lot_id, product_id, delta, reason, ref_id, actor_id)
    values (lot.household_id, lot.id, lot.product_id, applied, p_reason, p_ref, auth.uid());
  end if;

  return lot;
end;
$$;

-- Correcting a miscount: the client sends the target it wants, the server
-- computes the delta under a lock. Never a read-modify-write from a phone.
create or replace function set_lot_quantity(p_lot_id uuid, p_target numeric)
returns inventory_lot
language plpgsql
security definer
set search_path = public
as $$
declare lot inventory_lot;
begin
  if p_target is null or p_target < 0 then
    raise exception 'Quantity cannot be negative' using errcode = '22023';
  end if;
  select * into lot from inventory_lot where id = p_lot_id for update;
  if not found then
    raise exception 'Unknown lot' using errcode = 'P0002';
  end if;
  return adjust_lot(p_lot_id, p_target - lot.qty, 'correction');
end;
$$;

-- Oldest lot first, always. This is the rule that makes the expiry engine
-- mean anything: cooking drains what is closest to turning.
create or replace function consume_product(
  p_product_id uuid,
  p_qty        numeric,
  p_reason     movement_reason default 'cook',
  p_ref        uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  prod      product;
  lot       inventory_lot;
  remaining numeric := p_qty;
  take      numeric;
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

  for lot in
    select * from inventory_lot
     where product_id = p_product_id and qty > 0
     order by expires_on asc nulls last, purchased_on asc
     for update
  loop
    exit when remaining <= 0;
    take := least(lot.qty, remaining);
    perform adjust_lot(lot.id, -take, p_reason, p_ref);
    remaining := remaining - take;
  end loop;

  -- Returns what was actually consumed. A shortfall is information the
  -- caller needs, not an error to swallow.
  return p_qty - remaining;
end;
$$;

-- These run as their definer, so reachability is the whole security story:
-- drop PUBLIC's default EXECUTE grant and hand it only to signed-in users.
-- Each function re-checks membership itself; this is the outer gate.
revoke execute on function create_household(text, int) from public;
revoke execute on function join_household(text) from public;
revoke execute on function generate_invite_code() from public;
revoke execute on function add_stock(uuid, numeric, date, date, storage_place, numeric, movement_reason) from public;
revoke execute on function adjust_lot(uuid, numeric, movement_reason, uuid) from public;
revoke execute on function set_lot_quantity(uuid, numeric) from public;
revoke execute on function consume_product(uuid, numeric, movement_reason, uuid) from public;

grant execute on function create_household(text, int) to authenticated;
grant execute on function join_household(text) to authenticated;
grant execute on function generate_invite_code() to authenticated;
grant execute on function add_stock(uuid, numeric, date, date, storage_place, numeric, movement_reason) to authenticated;
grant execute on function adjust_lot(uuid, numeric, movement_reason, uuid) to authenticated;
grant execute on function set_lot_quantity(uuid, numeric) to authenticated;
grant execute on function consume_product(uuid, numeric, movement_reason, uuid) to authenticated;
