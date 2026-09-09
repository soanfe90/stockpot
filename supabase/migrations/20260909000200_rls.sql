-- Stockpot :: row-level security
--
-- The sharing requirement is enforced here, in the database, rather than
-- trusted to the client. Every table below is readable and writable only by
-- members of the household that owns the row.

-- Helper is SECURITY DEFINER so that consulting household_member from inside
-- a policy on household_member does not recurse.
create or replace function is_household_member(h uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from household_member
    where household_id = h and user_id = auth.uid()
  );
$$;

create or replace function is_household_owner(h uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from household_member
    where household_id = h and user_id = auth.uid() and role = 'owner'
  );
$$;

-- Revoke from PUBLIC, not just anon: Postgres grants EXECUTE to PUBLIC by
-- default, so revoking one role leaves the function reachable anyway. The
-- policies below call these, so `authenticated` must keep the grant.
revoke execute on function is_household_member(uuid) from public;
revoke execute on function is_household_owner(uuid)  from public;
grant  execute on function is_household_member(uuid) to authenticated;
grant  execute on function is_household_owner(uuid)  to authenticated;

alter table household         enable row level security;
alter table household_member  enable row level security;
alter table user_profile      enable row level security;
alter table product           enable row level security;
alter table product_alias     enable row level security;
alter table inventory_lot     enable row level security;
alter table stock_movement    enable row level security;

-- --------------------------------------------------------- households ----
-- Households are created and joined through SECURITY DEFINER functions, so
-- there is deliberately no INSERT policy here: you cannot conjure yourself
-- into a household by writing a row.

create policy household_select on household
  for select to authenticated
  using (is_household_member(id));

create policy household_update on household
  for update to authenticated
  using (is_household_owner(id))
  with check (is_household_owner(id));

create policy household_delete on household
  for delete to authenticated
  using (is_household_owner(id));

create policy member_select on household_member
  for select to authenticated
  using (is_household_member(household_id));

-- Leaving is always allowed; removing someone else requires ownership.
create policy member_delete on household_member
  for delete to authenticated
  using (user_id = auth.uid() or is_household_owner(household_id));

-- ------------------------------------------------------------ profile ----

create policy profile_select on user_profile
  for select to authenticated using (user_id = auth.uid());

create policy profile_insert on user_profile
  for insert to authenticated with check (user_id = auth.uid());

create policy profile_update on user_profile
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------- household-scoped tables ---
-- product, product_alias and inventory_lot are edited directly by the client;
-- stock_movement is append-only and written only by the ledger functions.

create policy product_all on product
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy alias_all on product_alias
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy lot_all on inventory_lot
  for all to authenticated
  using (is_household_member(household_id))
  with check (is_household_member(household_id));

create policy movement_select on stock_movement
  for select to authenticated
  using (is_household_member(household_id));
