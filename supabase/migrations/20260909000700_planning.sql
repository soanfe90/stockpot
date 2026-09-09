-- Stockpot :: Phase 4 (Plan and cook)
--
-- A plan is an allocation of stock, not a list of nice ideas. Approving one
-- reserves what it needs so the shopping list stops offering to sell you
-- groceries the plan already spoke for; cooking a meal releases that
-- reservation and deducts what was actually used.

create type plan_scope    as enum ('single', 'day', 'week');
create type plan_status   as enum ('draft', 'active', 'done', 'cancelled');
create type slot_status   as enum ('planned', 'cooking', 'done', 'skipped');
create type meal_category as enum ('breakfast', 'lunch', 'dinner', 'snack');
create type recipe_source as enum ('generated', 'library', 'user');

create table recipe (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references household(id) on delete cascade,
  name             text not null,
  category         meal_category not null,
  diet_types       text[] not null default '{}',
  cuisine          text,
  est_minutes      int check (est_minutes is null or est_minutes >= 0),
  servings         int not null default 2 check (servings > 0),
  total_calories   int check (total_calories is null or total_calories >= 0),
  steps            jsonb not null default '[]',
  tips             text[] not null default '{}',
  video_links      text[] not null default '{}',
  source           recipe_source not null default 'generated',
  -- Adapting a saved recipe forks it; the original is never modified.
  parent_recipe_id uuid references recipe(id) on delete set null,
  image_url        text,
  created_at       timestamptz not null default now()
);

create index recipe_household_idx on recipe(household_id, created_at desc);

create table recipe_ingredient (
  id           uuid primary key default gen_random_uuid(),
  recipe_id    uuid not null references recipe(id) on delete cascade,
  -- Null means a pantry staple the app does not track (salt, oil, water).
  -- Those are never deducted.
  product_id   uuid references product(id) on delete set null,
  name         text not null,
  qty          numeric(12,3) not null default 0 check (qty >= 0),
  display_unit text not null default 'g',
  base_unit    base_unit not null default 'g',
  optional     boolean not null default false,
  note         text,
  position     int not null default 0
);

create index recipe_ingredient_recipe_idx on recipe_ingredient(recipe_id, position);

create table meal_plan (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  scope        plan_scope not null,
  starts_on    date not null,
  ends_on      date not null,
  status       plan_status not null default 'draft',
  -- The preferences this plan was generated under. Changing them here never
  -- rewrites the household's profile.
  prefs        jsonb not null default '{}',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz
);

create index meal_plan_household_idx on meal_plan(household_id, starts_on desc);

create table meal_slot (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references meal_plan(id) on delete cascade,
  household_id uuid not null references household(id) on delete cascade,
  recipe_id    uuid not null references recipe(id) on delete cascade,
  scheduled_at timestamptz not null,
  category     meal_category not null,
  servings     int not null default 2 check (servings > 0),
  status       slot_status not null default 'planned',
  -- A slot the user liked. Day- and week-level regeneration routes around it.
  pinned       boolean not null default false,
  notify_at    timestamptz,
  position     int not null default 0,
  started_at   timestamptz
);

create index meal_slot_plan_idx     on meal_slot(plan_id, scheduled_at);
create index meal_slot_schedule_idx on meal_slot(household_id, scheduled_at)
  where status in ('planned', 'cooking');

-- Which lots a slot has claimed. Per-slot rather than per-plan, so cooking one
-- meal releases exactly its own claim and nothing else's.
create table reservation (
  id           uuid primary key default gen_random_uuid(),
  slot_id      uuid not null references meal_slot(id) on delete cascade,
  lot_id       uuid not null references inventory_lot(id) on delete cascade,
  product_id   uuid not null references product(id) on delete cascade,
  household_id uuid not null references household(id) on delete cascade,
  qty          numeric(12,3) not null check (qty > 0),
  created_at   timestamptz not null default now()
);

create index reservation_slot_idx on reservation(slot_id);
create index reservation_lot_idx  on reservation(lot_id);

create table cook_log (
  id              uuid primary key default gen_random_uuid(),
  slot_id         uuid references meal_slot(id) on delete set null,
  household_id    uuid not null references household(id) on delete cascade,
  recipe_id       uuid not null references recipe(id) on delete cascade,
  started_at      timestamptz,
  finished_at     timestamptz not null default now(),
  actual_servings int,
  rating          int check (rating between 1 and 5),
  comment         text,
  photo_url       text,
  -- What was actually taken out of stock, for the summary and for later
  -- comparison against what the recipe said.
  deductions      jsonb not null default '[]',
  created_by      uuid references auth.users(id) on delete set null
);

create index cook_log_household_idx on cook_log(household_id, finished_at desc);

-- ---------------------------------------------------------- reservations ---

-- Claims stock for one slot, oldest lot first, and claims only what is
-- actually free. A shortfall is not an error: it is what the shopping list is
-- for, so reserving takes what it can and reports the rest.
create or replace function reserve_slot(p_slot_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  slot      meal_slot;
  rec       recipe;
  ing       recipe_ingredient;
  lot       inventory_lot;
  scale     numeric;
  needed    numeric;
  free      numeric;
  take      numeric;
  shortfall numeric := 0;
begin
  select * into slot from meal_slot where id = p_slot_id for update;
  if not found then
    raise exception 'Unknown meal' using errcode = 'P0002';
  end if;
  if not is_household_member(slot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  select * into rec from recipe where id = slot.recipe_id;
  scale := slot.servings::numeric / greatest(rec.servings, 1);

  for ing in
    select * from recipe_ingredient
     where recipe_id = slot.recipe_id and product_id is not null and not optional
     order by position
  loop
    needed := ing.qty * scale;

    for lot in
      select * from inventory_lot
       where product_id = ing.product_id and qty > reserved_qty
       order by expires_on asc nulls last, purchased_on asc
       for update
    loop
      exit when needed <= 0;
      free := lot.qty - lot.reserved_qty;
      take := least(free, needed);
      if take <= 0 then continue; end if;

      update inventory_lot set reserved_qty = reserved_qty + take where id = lot.id;
      insert into reservation (slot_id, lot_id, product_id, household_id, qty)
      values (p_slot_id, lot.id, ing.product_id, slot.household_id, take);

      needed := needed - take;
    end loop;

    shortfall := shortfall + greatest(needed, 0);
  end loop;

  return shortfall;
end;
$$;

create or replace function release_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r reservation;
begin
  for r in select * from reservation where slot_id = p_slot_id loop
    update inventory_lot
       set reserved_qty = greatest(reserved_qty - r.qty, 0)
     where id = r.lot_id;
  end loop;
  delete from reservation where slot_id = p_slot_id;
end;
$$;

-- ------------------------------------------------------------- lifecycle ---

create or replace function approve_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan  meal_plan;
  slot  meal_slot;
  short numeric := 0;
begin
  select * into plan from meal_plan where id = p_plan_id for update;
  if not found then
    raise exception 'Unknown plan' using errcode = 'P0002';
  end if;
  if not is_household_member(plan.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if plan.status <> 'draft' then
    raise exception 'That plan has already been approved' using errcode = '55000';
  end if;

  for slot in select * from meal_slot where plan_id = p_plan_id order by scheduled_at loop
    short := short + reserve_slot(slot.id);
  end loop;

  update meal_plan set status = 'active', approved_at = now() where id = p_plan_id;

  return jsonb_build_object('reserved', true, 'shortfall_units', short);
end;
$$;

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

  update meal_plan set status = 'cancelled' where id = p_plan_id;
end;
$$;

create or replace function start_cooking(p_slot_id uuid)
returns meal_slot
language plpgsql
security definer
set search_path = public
as $$
declare slot meal_slot;
begin
  select * into slot from meal_slot where id = p_slot_id for update;
  if not found then
    raise exception 'Unknown meal' using errcode = 'P0002';
  end if;
  if not is_household_member(slot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if slot.status = 'done' then
    raise exception 'That meal is already finished' using errcode = '55000';
  end if;

  update meal_slot set status = 'cooking', started_at = coalesce(started_at, now())
   where id = p_slot_id
  returning * into slot;
  return slot;
end;
$$;

-- Finishing is the only thing that removes stock. The reservation is released
-- first, then what was actually used is deducted -- people substitute, burn
-- things, and cook for four when the plan said two, and a ledger that cannot
-- absorb that goes wrong and never recovers.
create or replace function finish_cooking(
  p_slot_id     uuid,
  p_servings    int     default null,
  p_rating      int     default null,
  p_comment     text    default null,
  p_photo_url   text    default null,
  p_adjustments jsonb   default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  slot       meal_slot;
  rec        recipe;
  ing        recipe_ingredient;
  scale      numeric;
  wanted     numeric;
  taken      numeric;
  deductions jsonb := '[]'::jsonb;
  log_id     uuid;
begin
  select * into slot from meal_slot where id = p_slot_id for update;
  if not found then
    raise exception 'Unknown meal' using errcode = 'P0002';
  end if;
  if not is_household_member(slot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if slot.status = 'done' then
    raise exception 'That meal is already finished' using errcode = '55000';
  end if;

  perform release_slot(p_slot_id);

  select * into rec from recipe where id = slot.recipe_id;
  scale := coalesce(p_servings, slot.servings)::numeric / greatest(rec.servings, 1);

  for ing in
    select * from recipe_ingredient
     where recipe_id = slot.recipe_id and product_id is not null
     order by position
  loop
    -- An explicit adjustment wins; otherwise scale the recipe to the servings
    -- actually cooked.
    wanted := coalesce((p_adjustments ->> ing.product_id::text)::numeric, ing.qty * scale);
    if wanted <= 0 then continue; end if;

    taken := consume_product(ing.product_id, wanted, 'cook', p_slot_id);

    deductions := deductions || jsonb_build_object(
      'product_id', ing.product_id,
      'name',       ing.name,
      'wanted',     wanted,
      'taken',      taken,
      'unit',       ing.display_unit
    );
  end loop;

  insert into cook_log (
    slot_id, household_id, recipe_id, started_at, actual_servings,
    rating, comment, photo_url, deductions, created_by
  ) values (
    p_slot_id, slot.household_id, slot.recipe_id, slot.started_at,
    coalesce(p_servings, slot.servings), p_rating, p_comment, p_photo_url,
    deductions, auth.uid()
  )
  returning id into log_id;

  update meal_slot set status = 'done' where id = p_slot_id;

  -- A plan with nothing left to cook is finished.
  update meal_plan set status = 'done'
   where id = slot.plan_id
     and not exists (
       select 1 from meal_slot
        where plan_id = slot.plan_id and status not in ('done', 'skipped')
     );

  return jsonb_build_object('cook_log_id', log_id, 'deductions', deductions);
end;
$$;

-- Skipping gives the stock back. Leaving it claimed to a meal nobody is going
-- to cook is how a pantry quietly looks emptier than it is.
create or replace function skip_meal(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare slot meal_slot;
begin
  select * into slot from meal_slot where id = p_slot_id for update;
  if not found then
    raise exception 'Unknown meal' using errcode = 'P0002';
  end if;
  if not is_household_member(slot.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if slot.status = 'done' then
    raise exception 'That meal is already finished' using errcode = '55000';
  end if;

  perform release_slot(p_slot_id);
  update meal_slot set status = 'skipped' where id = p_slot_id;

  update meal_plan set status = 'done'
   where id = slot.plan_id
     and not exists (
       select 1 from meal_slot
        where plan_id = slot.plan_id and status not in ('done', 'skipped')
     );
end;
$$;

-- ------------------------------------------------------------ shortfalls ---

-- What the plan still needs that the pantry cannot cover. A plan's own
-- reservations are added back before subtracting, so an approved plan does not
-- count its own claim against itself.
create or replace function plan_shortfalls(p_plan_id uuid)
returns table (
  product_id   uuid,
  product_name text,
  display_unit text,
  base_unit    base_unit,
  needed       numeric,
  available    numeric,
  shortfall    numeric,
  needed_by    date
)
language sql
stable
security definer
set search_path = public
as $$
  with plan_need as (
    select
      ri.product_id                                                        as pid,
      sum(ri.qty * (ms.servings::numeric / greatest(r.servings, 1)))       as need,
      min(ms.scheduled_at::date)                                           as first_needed
    from meal_slot ms
    join recipe r             on r.id = ms.recipe_id
    join recipe_ingredient ri on ri.recipe_id = ms.recipe_id
    where ms.plan_id = p_plan_id
      and ms.status in ('planned', 'cooking')
      and ri.product_id is not null
      and not ri.optional
    group by ri.product_id
  ),
  own as (
    select res.product_id as pid, sum(res.qty) as mine
    from reservation res
    join meal_slot ms on ms.id = res.slot_id
    where ms.plan_id = p_plan_id
    group by res.product_id
  )
  select
    p.id,
    p.name,
    p.display_unit,
    p.base_unit,
    pn.need,
    greatest(coalesce(s.qty_total, 0) - coalesce(s.qty_reserved, 0) + coalesce(o.mine, 0), 0),
    greatest(pn.need - greatest(coalesce(s.qty_total, 0) - coalesce(s.qty_reserved, 0) + coalesce(o.mine, 0), 0), 0),
    pn.first_needed
  from plan_need pn
  join product p             on p.id = pn.pid
  left join product_stock s  on s.product_id = p.id
  left join own o            on o.pid = p.id;
$$;

-- Puts those shortfalls on the shopping list, pinned so the list's own
-- refresh cannot quietly relabel or remove something a plan is waiting on.
create or replace function add_plan_gaps_to_list(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  plan meal_plan;
  l    shopping_list;
  gap  record;
  n    int := 0;
begin
  select * into plan from meal_plan where id = p_plan_id;
  if not found then
    raise exception 'Unknown plan' using errcode = 'P0002';
  end if;
  if not is_household_member(plan.household_id) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;

  l := open_shopping_list(plan.household_id);

  for gap in select * from plan_shortfalls(p_plan_id) where shortfall > 0 loop
    insert into shopping_item (
      list_id, household_id, product_id, name, qty, display_unit, base_unit,
      category, source, needed_by, pinned
    )
    select l.id, plan.household_id, gap.product_id, gap.product_name, gap.shortfall,
           gap.display_unit, gap.base_unit, p.category, 'recipe_gap', gap.needed_by, true
      from product p where p.id = gap.product_id
    on conflict (list_id, product_id) where source <> 'manual' and product_id is not null
    do update set
      qty       = greatest(shopping_item.qty, excluded.qty),
      source    = 'recipe_gap',
      needed_by = least(coalesce(shopping_item.needed_by, excluded.needed_by), excluded.needed_by),
      pinned    = true;
    n := n + 1;
  end loop;

  return n;
end;
$$;

-- ------------------------------------------------------------------ RLS ---

alter table recipe            enable row level security;
alter table recipe_ingredient enable row level security;
alter table meal_plan         enable row level security;
alter table meal_slot         enable row level security;
alter table reservation       enable row level security;
alter table cook_log          enable row level security;

create policy recipe_all on recipe
  for all to authenticated
  using (is_household_member(household_id)) with check (is_household_member(household_id));

-- Ingredients hang off a recipe, so membership is checked through it.
create policy recipe_ingredient_all on recipe_ingredient
  for all to authenticated
  using (exists (select 1 from recipe r where r.id = recipe_id and is_household_member(r.household_id)))
  with check (exists (select 1 from recipe r where r.id = recipe_id and is_household_member(r.household_id)));

create policy meal_plan_all on meal_plan
  for all to authenticated
  using (is_household_member(household_id)) with check (is_household_member(household_id));

create policy meal_slot_all on meal_slot
  for all to authenticated
  using (is_household_member(household_id)) with check (is_household_member(household_id));

-- Reservations are written only by reserve_slot/release_slot.
create policy reservation_select on reservation
  for select to authenticated using (is_household_member(household_id));

create policy cook_log_all on cook_log
  for all to authenticated
  using (is_household_member(household_id)) with check (is_household_member(household_id));

revoke execute on function reserve_slot(uuid)          from public;
revoke execute on function release_slot(uuid)          from public;
revoke execute on function approve_plan(uuid)          from public;
revoke execute on function cancel_plan(uuid)           from public;
revoke execute on function start_cooking(uuid)         from public;
revoke execute on function finish_cooking(uuid, int, int, text, text, jsonb) from public;
revoke execute on function skip_meal(uuid)             from public;
revoke execute on function plan_shortfalls(uuid)       from public;
revoke execute on function add_plan_gaps_to_list(uuid) from public;

grant execute on function approve_plan(uuid)          to authenticated;
grant execute on function cancel_plan(uuid)           to authenticated;
grant execute on function start_cooking(uuid)         to authenticated;
grant execute on function finish_cooking(uuid, int, int, text, text, jsonb) to authenticated;
grant execute on function skip_meal(uuid)             to authenticated;
grant execute on function plan_shortfalls(uuid)       to authenticated;
grant execute on function add_plan_gaps_to_list(uuid) to authenticated;
