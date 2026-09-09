-- Stockpot :: Phase 1 (Ledger)
-- Households, the product catalog, dated inventory lots, and an append-only
-- movement log. Every quantity in this schema is stored in the product's
-- base unit (g, ml, or countable unit) -- never in display units.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enums ---

create type member_role    as enum ('owner', 'member');
create type base_unit      as enum ('g', 'ml', 'unit');
create type storage_place  as enum ('fridge', 'freezer', 'pantry');
create type movement_reason as enum ('purchase', 'cook', 'waste', 'correction');

-- ----------------------------------------------------------- households ---

create table household (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 60),
  invite_code  text not null unique,
  size         int  not null default 2 check (size between 1 and 20),
  created_at   timestamptz not null default now()
);

create table household_member (
  household_id uuid not null references household(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         member_role not null default 'member',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_member_user_idx on household_member(user_id);

-- One row per authenticated user. Preferences steer generation from Phase 4
-- onward; they are collected at signup because asking later never happens.
create table user_profile (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  diet_types   text[] not null default '{}',
  cuisines     text[] not null default '{}',
  goals        text[] not null default '{}',
  allergens    text[] not null default '{}',
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------------- catalog ---

-- The *idea* of a product ("whole milk"), not a quantity of it.
create table product (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references household(id) on delete cascade,
  name                      text not null check (length(trim(name)) between 1 and 80),
  category                  text not null,
  base_unit                 base_unit not null,
  -- What the user sees and types. 'kg' displays a base_unit of 'g' scaled by
  -- 1000; the ledger itself never leaves the base unit.
  display_unit              text not null,
  -- Weight of one countable item, so "2 chicken breasts" can be reconciled
  -- against 1.8 kg of chicken. Null when the product is not counted.
  grams_per_unit            numeric(10,2) check (grams_per_unit is null or grams_per_unit > 0),
  default_useful_life_days  int not null default 7 check (default_useful_life_days between 0 and 3650),
  low_threshold             numeric(12,3) not null default 0 check (low_threshold >= 0),
  storage                   storage_place not null default 'pantry',
  image_url                 text,
  barcode                   text,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Expression uniqueness needs an index, not a table constraint: one product
-- per household per name, case-insensitively.
create unique index product_name_key on product(household_id, lower(name));
create index product_household_idx on product(household_id);
create index product_category_idx  on product(household_id, category);

-- Learned receipt strings. Phase 2 writes these on every confirmed
-- correction so the same till line resolves exactly on the next shop.
create table product_alias (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  product_id   uuid not null references product(id) on delete cascade,
  raw_text     text not null,
  source       text not null default 'manual',
  hit_count    int  not null default 0,
  created_at   timestamptz not null default now()
);

create unique index product_alias_text_key on product_alias(household_id, lower(raw_text));

create index product_alias_product_idx on product_alias(product_id);

-- ------------------------------------------------------------- the lots ---

-- A real quantity with a real date. Two cartons of milk bought a week apart
-- are two lots -- merging them would discard the data the app runs on.
create table inventory_lot (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references household(id) on delete cascade,
  product_id    uuid not null references product(id) on delete cascade,
  qty           numeric(12,3) not null default 0 check (qty >= 0),
  -- Claimed by an approved meal plan but not yet cooked. Keeps the shopping
  -- list from offering to sell you groceries the plan already spoke for.
  reserved_qty  numeric(12,3) not null default 0 check (reserved_qty >= 0),
  purchased_on  date not null default current_date,
  expires_on    date,
  opened_at     date,
  storage       storage_place not null default 'pantry',
  unit_price    numeric(10,2),
  created_at    timestamptz not null default now(),
  constraint reserved_within_qty check (reserved_qty <= qty)
);

create index inventory_lot_product_idx  on inventory_lot(product_id);
create index inventory_lot_expiry_idx   on inventory_lot(household_id, expires_on)
  where qty > 0;

-- Append-only. Every change to qty passes through here, which is what makes
-- a drifting ledger debuggable instead of mysterious.
create table stock_movement (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references household(id) on delete cascade,
  lot_id       uuid references inventory_lot(id) on delete set null,
  product_id   uuid not null references product(id) on delete cascade,
  delta        numeric(12,3) not null,
  reason       movement_reason not null,
  ref_id       uuid,
  actor_id     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index stock_movement_product_idx on stock_movement(product_id, created_at desc);

-- ----------------------------------------------------------------- view ---

-- One round trip for the inventory screen: catalog plus rolled-up stock.
-- security_invoker keeps the caller's RLS in force through the view.
create view product_stock with (security_invoker = true) as
select
  p.id                                                as product_id,
  p.household_id,
  coalesce(sum(l.qty), 0)::numeric(12,3)              as qty_total,
  coalesce(sum(l.reserved_qty), 0)::numeric(12,3)     as qty_reserved,
  min(l.expires_on)                                   as next_expiry,
  count(l.id)                                         as lot_count
from product p
left join inventory_lot l
  on l.product_id = p.id and l.qty > 0
group by p.id;

-- --------------------------------------------------------------- touch ----

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger product_touch before update on product
  for each row execute function touch_updated_at();
