-- Stockpot :: swapping a meal inside an approved plan
--
-- Regenerating one meal was restricted to draft plans, which in practice meant
-- it was never available: the Meals tab only ever shows meals belonging to an
-- approved plan, so the swap button was gated on a state the user had already
-- left behind by the time they wanted it.
--
-- The reason for the restriction was real -- an approved plan holds
-- reservations against its recipes, and rewriting a meal underneath one leaves
-- the claim and the recipe disagreeing. The answer is to move the claim with
-- the meal, in one transaction, rather than to forbid it.

-- Hands one meal's place in a plan to another, already-written meal.
--
-- Deliberately the *last* step of a swap: the replacement's recipe and slot are
-- written first and unreserved, so a generation that fails, or a write that
-- fails, changes nothing at all. Only this call moves the claim, and it does so
-- atomically -- there is no moment where the plan holds two meals for one
-- sitting, or none.
create or replace function swap_slot(p_old_slot_id uuid, p_new_slot_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_slot meal_slot;
  new_slot meal_slot;
  old_recipe_id uuid;
  shortfall numeric := 0;
begin
  -- Guarded explicitly rather than left to fail late: swapping a meal with
  -- itself would release its claim, delete it, and only then discover there is
  -- nothing to reserve. The rollback would tidy that up, but relying on a
  -- rollback to enforce a rule is not the same as enforcing it.
  if p_old_slot_id = p_new_slot_id then
    raise exception 'A meal cannot replace itself' using errcode = '22023';
  end if;

  select * into old_slot from meal_slot where id = p_old_slot_id for update;
  if not found then
    raise exception 'Unknown meal' using errcode = 'P0002';
  end if;
  select * into new_slot from meal_slot where id = p_new_slot_id for update;
  if not found then
    raise exception 'Unknown replacement' using errcode = 'P0002';
  end if;

  if not is_household_member(old_slot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if old_slot.household_id <> new_slot.household_id or old_slot.plan_id <> new_slot.plan_id then
    raise exception 'Those meals are not in the same plan' using errcode = '22023';
  end if;
  -- A meal being cooked has a pan on the stove. Cooking is what deducts stock,
  -- and it reads the recipe as it goes.
  if old_slot.status <> 'planned' then
    raise exception 'That meal is already underway' using errcode = '22023';
  end if;

  old_recipe_id := old_slot.recipe_id;

  -- Give the claim back before taking a new one, so the replacement can spend
  -- the very food the meal it replaces was holding.
  perform release_slot(p_old_slot_id);
  delete from meal_slot where id = p_old_slot_id;

  -- A generated recipe exists for its slot alone; once that slot is gone and
  -- it was never cooked, it is nothing but clutter in the library.
  delete from recipe r
   where r.id = old_recipe_id
     and r.source = 'generated'
     and not exists (select 1 from meal_slot s where s.recipe_id = r.id)
     and not exists (select 1 from cook_log c where c.recipe_id = r.id);

  -- Only an approved plan holds claims; a draft reserves nothing until it is
  -- approved, and reserving here would double-count it at approval.
  if (select status from meal_plan where id = new_slot.plan_id) <> 'draft' then
    shortfall := reserve_slot(p_new_slot_id);
  end if;

  -- reserve_slot reports what it could *not* claim, which is the honest
  -- outcome to pass up: a replacement the pantry cannot fully cover is still
  -- worth having, and the shortfall belongs on the shopping list.
  return jsonb_build_object('shortfall_units', shortfall);
end;
$$;

revoke execute on function swap_slot(uuid, uuid) from public;
grant  execute on function swap_slot(uuid, uuid) to authenticated;
