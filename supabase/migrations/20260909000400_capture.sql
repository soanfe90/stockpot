-- Stockpot :: Phase 2 (Capture)
--
-- A photo becomes a `capture`; the model's reading of it becomes editable
-- `draft_line` rows; committing the tray turns those into real stock through
-- the same ledger functions the manual path uses. Nothing touches inventory
-- until the user presses commit.

create type capture_kind     as enum ('receipt', 'products');
create type capture_status   as enum ('uploaded', 'scanning', 'ready', 'committed', 'failed');
create type line_resolution  as enum ('merge', 'new', 'skip');

create table capture (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  kind          capture_kind not null,
  image_path    text,
  status        capture_status not null default 'uploaded',
  store         text,
  purchased_on  date,
  -- Kept verbatim so a bad read can be diagnosed after the fact without
  -- re-running the scan (and re-paying for it).
  model_response jsonb,
  error         text,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  committed_at  timestamptz
);

create index capture_household_idx on capture(household_id, created_at desc);

create table draft_line (
  id                 uuid primary key default gen_random_uuid(),
  capture_id         uuid not null references capture(id) on delete cascade,
  household_id       uuid not null references household(id) on delete cascade,
  -- What the till actually printed. This is what alias learning stores, so
  -- the same abbreviation resolves without a model call next time.
  raw_text           text,
  name               text not null,
  qty                numeric(12,3) not null default 0 check (qty >= 0),
  display_unit       text not null,
  base_unit          base_unit not null,
  category           text not null default 'Other',
  unit_price         numeric(10,2),
  expires_on         date,
  storage            storage_place,
  matched_product_id uuid references product(id) on delete set null,
  confidence         numeric(3,2) check (confidence between 0 and 1),
  resolution         line_resolution not null default 'new',
  skip_reason        text,
  position           int not null default 0,
  created_at         timestamptz not null default now()
);

create index draft_line_capture_idx on draft_line(capture_id, position);

-- ---------------------------------------------------------------- units ---

-- Display unit -> base unit factor. This mirrors DISPLAY_UNITS in
-- src/lib/units.ts and the two must stay in step; the database is the
-- authority at commit time, because that is where stock is actually written.
create or replace function to_base_qty(p_qty numeric, p_display_unit text)
returns numeric
language sql
immutable
as $$
  select p_qty * case lower(p_display_unit)
    when 'kg' then 1000
    when 'l'  then 1000
    else 1
  end;
$$;

-- Which base unit a display unit belongs to. Used to refuse a merge whose
-- units cannot mean the same thing as the product's.
create or replace function base_of_display_unit(p_display_unit text)
returns base_unit
language sql
immutable
as $$
  select case lower(p_display_unit)
    when 'g'  then 'g'::base_unit
    when 'kg' then 'g'::base_unit
    when 'ml' then 'ml'::base_unit
    when 'l'  then 'ml'::base_unit
    else 'unit'::base_unit
  end;
$$;

-- ------------------------------------------------------------- committing -

-- Turns a reviewed draft tray into stock, in one transaction:
--   * merge  -> add to the matched product
--   * new    -> create the product, then add to it
--   * skip   -> ignored (bags, deposits, discounts, the total line)
-- Every quantity goes in through add_stock, so lots, expiry inference and
-- the movement log all behave exactly as they do for a manual entry.
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
          greatest(coalesce(line.expires_on - v_purchased, 7), 0),
          coalesce(line.storage, 'pantry')
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

-- ------------------------------------------------------------------ RLS ---

alter table capture    enable row level security;
alter table draft_line enable row level security;

create policy capture_all on capture
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy draft_line_all on draft_line
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

revoke execute on function commit_capture(uuid) from public;
revoke execute on function to_base_qty(numeric, text) from public;
revoke execute on function base_of_display_unit(text) from public;
grant  execute on function commit_capture(uuid) to authenticated;
grant  execute on function to_base_qty(numeric, text) to authenticated;
grant  execute on function base_of_display_unit(text) to authenticated;
