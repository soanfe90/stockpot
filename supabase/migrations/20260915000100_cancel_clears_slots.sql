-- Stockpot :: cancelling a plan clears its meals off the schedule
--
-- cancel_plan marked the plan cancelled and left every meal_slot at 'planned'.
-- Nothing downstream looks at the plan's status: the Meals tab, plan_shortfalls
-- and the reminder queue all filter on the slot's. So a deleted plan kept every
-- one of its meals on the schedule, its shortfalls in the sum, and its
-- reminders queued -- and from the outside, deleting a plan did nothing.

create or replace function cancel_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  plan meal_plan;
  slot meal_slot;
begin
  select * into plan from meal_plan where id = p_plan_id for update;
  if not found then
    raise exception 'Unknown plan' using errcode = 'P0002';
  end if;
  if not is_household_member(plan.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  for slot in select * from meal_slot where plan_id = p_plan_id loop
    perform release_slot(slot.id);
  end loop;

  -- Rows this plan put on the list, and only those: a row someone has already
  -- ticked is theirs now, and one that would still be needed for another
  -- reason will come back on the next refresh anyway.
  delete from shopping_item si
   using shopping_list sl
   where si.list_id = sl.id
     and sl.household_id = plan.household_id
     and sl.status <> 'closed'
     and si.source = 'recipe_gap'
     and not si.checked
     and si.product_id in (
       select ri.product_id
         from meal_slot ms
         join recipe_ingredient ri on ri.recipe_id = ms.recipe_id
        where ms.plan_id = p_plan_id
          and ri.product_id is not null
     )
     -- Unless another live plan is still waiting on the same thing.
     and not exists (
       select 1
         from meal_slot ms2
         join recipe_ingredient ri2 on ri2.recipe_id = ms2.recipe_id
         join meal_plan mp2 on mp2.id = ms2.plan_id
        where ri2.product_id = si.product_id
          and mp2.id <> p_plan_id
          and mp2.status in ('draft', 'active')
          and ms2.status in ('planned', 'cooking')
     );

  -- The meals themselves, not only the plan they belong to. Everything that
  -- reads the schedule -- the Meals tab, the shortfall sum, the reminders --
  -- filters on the *slot's* status, so a cancelled plan whose slots were left
  -- 'planned' stayed on the schedule in full. Deleting a plan appeared to do
  -- nothing at all.
  --
  -- Skipped rather than deleted, and only the ones not yet started: a meal
  -- already cooked is history the library keeps, and a pan on the stove is not
  -- something to quietly abandon out from under whoever is cooking.
  update meal_slot
     set status = 'skipped'
   where plan_id = p_plan_id
     and status = 'planned';

  update meal_plan set status = 'cancelled' where id = p_plan_id;

  -- A cancelled plan's meals are gone, so the products invented for them have
  -- nothing left wanting them.
  perform prune_planned_products(plan.household_id);
end;
$$;
