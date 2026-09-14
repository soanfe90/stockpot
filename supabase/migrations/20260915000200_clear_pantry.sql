-- Stockpot :: emptying the pantry
--
-- There was no way back from a bad scan. Forty products entered wrongly had to
-- be deleted one at a time, and someone trying the app out had no way to start
-- again -- which makes the first bad import the last thing they do with it.
--
-- Two different things get asked for under "clear the pantry", so both are
-- offered: throwing out the *stock* while keeping the catalogue of what the
-- household buys, and throwing out the catalogue too.

create or replace function clear_pantry(
  p_household_id     uuid,
  p_delete_products  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan        meal_plan;
  v_plans     int := 0;
  v_lots      int := 0;
  v_products  int := 0;
begin
  if not is_household_member(p_household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  -- Live plans hold reservations against lots that are about to stop existing.
  -- Cancelling them first is what keeps the ledger consistent: it releases
  -- every claim and takes their rows off the shopping list, through the same
  -- path deleting a plan by hand uses.
  for plan in
    select * from meal_plan where household_id = p_household_id and status in ('draft', 'active')
  loop
    perform cancel_plan(plan.id);
    v_plans := v_plans + 1;
  end loop;

  with gone as (
    delete from inventory_lot where household_id = p_household_id returning 1
  )
  select count(*) into v_lots from gone;

  -- stock_movement.lot_id is ON DELETE SET NULL, so the history of what was
  -- bought and cooked survives emptying the shelves. Deleting the products
  -- themselves does take it, because it cascades from product_id -- which is
  -- the honest meaning of "delete the product", and why it is a separate ask.
  if p_delete_products then
    with gone as (
      delete from product where household_id = p_household_id returning 1
    )
    select count(*) into v_products from gone;
  end if;

  return jsonb_build_object(
    'plans_cancelled', v_plans,
    'lots_removed',    v_lots,
    'products_removed', v_products
  );
end;
$$;

revoke execute on function clear_pantry(uuid, boolean) from public;
grant  execute on function clear_pantry(uuid, boolean) to authenticated;
