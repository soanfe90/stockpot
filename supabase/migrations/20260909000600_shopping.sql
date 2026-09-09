-- Stockpot :: Phase 3 (Shopping list)
--
-- The list writes itself from the ledger, then writes back into it. Suggested
-- rows are recomputed from stock; manual rows and anything the user has
-- touched are left alone. Closing a trip goes through add_stock, the same
-- path the draft tray and the manual form use.
--
-- Quantities here are in the product's base unit, as everywhere else.

create type shopping_status as enum ('open', 'shopping', 'closed');
create type item_source     as enum ('out_of_stock', 'low', 'expiring', 'recipe_gap', 'manual');

create table shopping_list (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  status       shopping_status not null default 'open',
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz
);

-- One open list per household: two live lists would split a shared trip.
create unique index shopping_list_one_open
  on shopping_list(household_id) where status <> 'closed';

create table shopping_item (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references shopping_list(id) on delete cascade,
  household_id  uuid not null references household(id) on delete cascade,
  product_id    uuid references product(id) on delete set null,
  name          text not null,
  qty           numeric(12,3) not null default 0 check (qty >= 0),
  display_unit  text not null default 'ud',
  base_unit     base_unit not null default 'unit',
  category      text not null default 'Other',
  source        item_source not null default 'manual',
  needed_by     date,
  checked       boolean not null default false,
  purchased_qty numeric(12,3) check (purchased_qty is null or purchased_qty >= 0),
  -- Set the moment a person edits or checks a row. Refresh will not remove or
  -- overwrite a pinned row: the app must never undo something someone did
  -- while standing in an aisle.
  pinned        boolean not null default false,
  note          text,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);

-- Suggestions are one-per-product; manual rows are free to repeat.
create unique index shopping_item_auto_key
  on shopping_item(list_id, product_id) where source <> 'manual' and product_id is not null;
create index shopping_item_list_idx on shopping_item(list_id, checked, position);

create table purchase (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  list_id      uuid references shopping_list(id) on delete set null,
  store        text,
  total        numeric(10,2),
  items        jsonb not null default '[]',
  closed_by    uuid references auth.users(id) on delete set null,
  closed_at    timestamptz not null default now()
);

create index purchase_household_idx on purchase(household_id, closed_at desc);

-- --------------------------------------------------------------- helpers ---

-- How much to suggest buying. What the household actually bought last time
-- beats any default, so past purchases answer this once there are any.
create or replace function suggest_qty(p_product_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prod product;
  last_qty numeric;
begin
  select * into prod from product where id = p_product_id;
  if not found then return 1; end if;

  select delta into last_qty
    from stock_movement
   where product_id = p_product_id and reason = 'purchase' and delta > 0
   order by created_at desc
   limit 1;

  return coalesce(last_qty, nullif(prod.low_threshold, 0), to_base_qty(1, prod.display_unit));
end;
$$;

create or replace function open_shopping_list(p_household_id uuid)
returns shopping_list
language plpgsql
security definer
set search_path = public
as $$
declare l shopping_list;
begin
  if not is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  select * into l from shopping_list
   where household_id = p_household_id and status <> 'closed'
   limit 1;

  if not found then
    insert into shopping_list (household_id) values (p_household_id) returning * into l;
  end if;

  return l;
end;
$$;

-- ------------------------------------------------------------- refreshing -

-- What the household needs, and why. One row per product, most actionable
-- reason winning: nothing in the house beats running low, and both beat a
-- replacement for something about to turn. Shared by the refresh and the
-- cleanup below so the two can never disagree about what belongs on the list.
create or replace function needs_restocking(p_household_id uuid)
returns table (product_id uuid, source item_source, needed_by date)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    (case
       when coalesce(s.qty_total, 0) <= 0 then 'out_of_stock'
       when p.low_threshold > 0 and s.qty_total <= p.low_threshold then 'low'
       else 'expiring'
     end)::item_source,
    s.next_expiry
  from product p
  join product_stock s on s.product_id = p.id
  where p.household_id = p_household_id
    and (
      coalesce(s.qty_total, 0) <= 0
      or (p.low_threshold > 0 and s.qty_total <= p.low_threshold)
      or (s.qty_total > 0 and s.next_expiry is not null and s.next_expiry <= current_date + 3)
    );
$$;

-- Recomputes the suggested rows against current stock. Manual rows, checked
-- rows and edited rows survive untouched -- the app must never undo something
-- someone did while standing in an aisle.
create or replace function refresh_shopping_list(p_household_id uuid)
returns shopping_list
language plpgsql
security definer
set search_path = public
as $$
declare l shopping_list;
begin
  l := open_shopping_list(p_household_id);

  insert into shopping_item (
    list_id, household_id, product_id, name, qty, display_unit, base_unit,
    category, source, needed_by
  )
  select
    l.id, p_household_id, p.id, p.name, suggest_qty(p.id), p.display_unit, p.base_unit,
    p.category, n.source, n.needed_by
  from needs_restocking(p_household_id) n
  join product p on p.id = n.product_id
  on conflict (list_id, product_id) where source <> 'manual' and product_id is not null
  do update set
    -- Only the reason and the name refresh; the quantity is left alone once a
    -- person has touched it.
    source    = excluded.source,
    needed_by = excluded.needed_by,
    name      = excluded.name
  where not shopping_item.pinned and not shopping_item.checked;

  delete from shopping_item si
   where si.list_id = l.id
     and si.source <> 'manual'
     and not si.pinned
     and not si.checked
     and (
       si.product_id is null
       or si.product_id not in (select n.product_id from needs_restocking(p_household_id) n)
     );

  return l;
end;
$$;

-- -------------------------------------------------------------- closing ----

-- Turns a finished trip into stock and a purchase record. Unchecked rows are
-- not discarded: they roll onto the next list, because "we didn't find it"
-- is the most common reason a line goes unticked.
create or replace function close_purchase(
  p_list_id uuid,
  p_store   text default null,
  p_total   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l          shopping_list;
  item       shopping_item;
  prod       product;
  next_list  shopping_list;
  v_qty      numeric;
  v_added    int := 0;
  v_created  int := 0;
  v_rolled   int := 0;
  v_items    jsonb := '[]'::jsonb;
begin
  select * into l from shopping_list where id = p_list_id for update;
  if not found then
    raise exception 'Unknown shopping list' using errcode = 'P0002';
  end if;
  if not is_household_member(l.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if l.status = 'closed' then
    raise exception 'That trip is already closed' using errcode = '55000';
  end if;

  for item in select * from shopping_item where list_id = p_list_id and checked order by position loop
    v_qty := coalesce(item.purchased_qty, item.qty);
    if v_qty <= 0 then continue; end if;

    prod := null;
    if item.product_id is not null then
      select * into prod from product where id = item.product_id and household_id = l.household_id;
    end if;

    if prod.id is null then
      select * into prod from product
       where household_id = l.household_id and lower(name) = lower(trim(item.name));
      if prod.id is null then
        insert into product (household_id, name, category, base_unit, display_unit, storage)
        values (l.household_id, trim(item.name), item.category, item.base_unit, item.display_unit, 'pantry')
        returning * into prod;
        v_created := v_created + 1;
      end if;
    end if;

    if base_of_display_unit(item.display_unit) <> prod.base_unit then
      raise exception
        '"%" is measured in % but % is tracked by %. Fix the unit before finishing.',
        item.name, item.display_unit, prod.name, prod.base_unit
        using errcode = '22023';
    end if;

    -- Expiry is left to add_stock, which infers it from the product's useful
    -- life -- exactly as it does for a scanned or hand-typed item.
    perform add_stock(prod.id, v_qty, null, current_date, prod.storage, null, 'purchase');

    v_items := v_items || jsonb_build_object(
      'product_id', prod.id, 'name', prod.name, 'qty', v_qty,
      'display_unit', item.display_unit, 'source', item.source
    );
    v_added := v_added + 1;
  end loop;

  insert into purchase (household_id, list_id, store, total, items, closed_by)
  values (l.household_id, l.id, p_store, p_total, v_items, auth.uid());

  update shopping_list set status = 'closed', closed_at = now() where id = l.id;

  insert into shopping_list (household_id) values (l.household_id) returning * into next_list;

  with rolled as (
    update shopping_item
       set list_id = next_list.id, purchased_qty = null
     where list_id = l.id and not checked
    returning 1
  )
  select count(*) into v_rolled from rolled;

  return jsonb_build_object(
    'items_added',      v_added,
    'products_created', v_created,
    'rolled_over',      v_rolled,
    'next_list_id',     next_list.id
  );
end;
$$;

-- ------------------------------------------------------------------ RLS ---

alter table shopping_list enable row level security;
alter table shopping_item enable row level security;
alter table purchase      enable row level security;

create policy shopping_list_all on shopping_list
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy shopping_item_all on shopping_item
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy purchase_select on purchase
  for select to authenticated
  using (is_household_member(household_id));

revoke execute on function open_shopping_list(uuid)                from public;
revoke execute on function refresh_shopping_list(uuid)             from public;
revoke execute on function close_purchase(uuid, text, numeric)     from public;
revoke execute on function suggest_qty(uuid)                       from public;
revoke execute on function needs_restocking(uuid)                  from public;

grant execute on function open_shopping_list(uuid)                to authenticated;
grant execute on function refresh_shopping_list(uuid)             to authenticated;
grant execute on function close_purchase(uuid, text, numeric)     to authenticated;
grant execute on function suggest_qty(uuid)                       to authenticated;
grant execute on function needs_restocking(uuid)                  to authenticated;
