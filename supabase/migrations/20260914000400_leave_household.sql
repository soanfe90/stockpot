-- Stockpot :: leaving a household
--
-- Signing out is not the same as getting out. Until now there was no way to
-- leave a household at all: a code typed wrong, or a household set up to try
-- the app, was permanent.

create or replace function leave_household()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hh_id     uuid;
  hh_name   text;
  remaining int;
  heir      uuid;
  v_deleted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select m.household_id, h.name
    into hh_id, hh_name
    from household_member m
    join household h on h.id = m.household_id
   where m.user_id = auth.uid()
   order by m.joined_at
   limit 1;

  if hh_id is null then
    raise exception 'You are not in a household' using errcode = 'P0002';
  end if;

  delete from household_member where household_id = hh_id and user_id = auth.uid();

  select count(*) into remaining from household_member where household_id = hh_id;

  if remaining = 0 then
    -- Last one out. Everything cascades, because nothing could ever read it
    -- again: an orphaned household is unreachable by every policy in the
    -- schema, so leaving it behind would only be invisible clutter.
    delete from household where id = hh_id;
    v_deleted := true;
  elsif not exists (
    select 1 from household_member where household_id = hh_id and role = 'owner'
  ) then
    -- Never leave a household ownerless. The longest-standing member inherits
    -- it, rather than everyone losing the ability to invite anyone again.
    select user_id into heir
      from household_member
     where household_id = hh_id
     order by joined_at
     limit 1;

    update household_member
       set role = 'owner'
     where household_id = hh_id and user_id = heir;
  end if;

  return jsonb_build_object('name', hh_name, 'deleted', v_deleted, 'members_left', remaining);
end;
$$;

revoke execute on function leave_household() from public;
grant  execute on function leave_household() to authenticated;
