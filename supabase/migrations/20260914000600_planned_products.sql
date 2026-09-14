-- Stockpot :: products a plan intends to buy
--
-- Planning strictly from stock is what the app was built on, and with a full
-- pantry it is right. With forty products it is a cage: the planner can only
-- recombine the same handful of things, so a week of meals repeats itself.
--
-- A plan may now reach past the shelf -- but an ingredient that is not in the
-- house still has to be a real product, or none of the machinery downstream
-- works: plan_shortfalls measures per product, add_plan_gaps_to_list writes per
-- product, close_purchase stocks per product, and finish_cooking deducts per
-- product. So the planner creates the product with no stock in it, and the
-- whole existing path -- shortfall, shopping list, purchase, deduction --
-- carries it the rest of the way without a single new mechanism.
--
-- What that needs is a way to tell "we intend to buy this" apart from "we are
-- out of this", because only the second belongs on the list on its own.

alter table product
  add column planned boolean not null default false;

comment on column product.planned is
  'Created by the planner for a meal, never yet stocked. Reaches the shopping '
  'list only through the plan that wants it, and stops being planned the '
  'moment any stock arrives.';

create index product_planned_idx on product(household_id) where planned;

-- The list writes itself from what the household actually keeps. A product
-- that has never been in the house has no restocking level to fall below and
-- no expiry to approach -- it is on the list because a meal wants it, which is
-- add_plan_gaps_to_list's job, or not at all.
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
    and not p.planned
    and (
      coalesce(s.qty_total, 0) <= 0
      or (p.low_threshold > 0 and s.qty_total <= p.low_threshold)
      or (s.qty_total > 0 and s.next_expiry is not null and s.next_expiry <= current_date + 3)
    );
$$;

-- Stock arriving is what turns an intention into a product the household
-- keeps. Doing it here rather than at the till covers every route in: the
-- manual form, the capture commit, and closing a shopping trip all come
-- through add_stock.
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

  return lot;
end;
$$;

-- Clears out intentions nothing wants any more: a product the planner invented
-- for a plan that was discarded, never stocked and on no list, is clutter in
-- the catalogue and a duplicate waiting to happen the next time the same thing
-- is actually bought.
create or replace function prune_planned_products(p_household_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  with dead as (
    delete from product p
     where p.household_id = p_household_id
       and p.planned
       and not exists (select 1 from inventory_lot l where l.product_id = p.id)
       and not exists (
         select 1
           from recipe_ingredient ri
           join meal_slot ms  on ms.recipe_id = ri.recipe_id
           join meal_plan mp  on mp.id = ms.plan_id
          where ri.product_id = p.id
            and mp.status in ('draft', 'active')
       )
       and not exists (
         select 1 from shopping_item si
          join shopping_list sl on sl.id = si.list_id
         where si.product_id = p.id and sl.status <> 'closed'
       )
    returning 1
  )
  select count(*) into n from dead;

  return n;
end;
$$;

revoke execute on function prune_planned_products(uuid) from public;
grant  execute on function prune_planned_products(uuid) to authenticated;
