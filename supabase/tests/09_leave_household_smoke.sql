\set ON_ERROR_STOP on
-- Leaving a household: the data survives if anyone is left, and goes if
-- nobody is.

insert into auth.users (id) values
  ('1c1c1c1c-1d1d-1e1e-1f1f-101010101010'),
  ('2c2c2c2c-2d2d-2e2e-2f2f-202020202020'),
  ('3c3c3c3c-3d3d-3e3e-3f3f-303030303030');

set role authenticated;
set request.jwt.claim.sub = '1c1c1c1c-1d1d-1e1e-1f1f-101010101010';
select id as hh, invite_code as code from create_household('Casa Salida', 3) \gset

set request.jwt.claim.sub = '2c2c2c2c-2d2d-2e2e-2f2f-202020202020';
\o /dev/null
select join_household(:'code');
\o
set request.jwt.claim.sub = '3c3c3c3c-3d3d-3e3e-3f3f-303030303030';
\o /dev/null
select join_household(:'code');
\o

insert into product (household_id, name, category, base_unit, display_unit)
values (:'hh', 'Lentejas', 'Grains & Pasta', 'g', 'g') returning id as lent \gset

-- The owner leaves first, which is the case that can orphan a household.
set request.jwt.claim.sub = '1c1c1c1c-1d1d-1e1e-1f1f-101010101010';
do $$
declare r jsonb;
begin
  r := leave_household();
  if (r->>'deleted')::boolean then raise exception 'FAIL: the household was deleted with people still in it'; end if;
  if (r->>'members_left')::int <> 2 then raise exception 'FAIL: expected 2 left, got %', r->>'members_left'; end if;
end $$;
\echo '  [1] the owner can leave a household other people are still in'

do $$ begin
  -- They are out: their own policies no longer reach any of it.
  if exists (select 1 from product where name = 'Lentejas')
    then raise exception 'FAIL: someone who left still reads the pantry'; end if;
end $$;
\echo '  [2] once out, none of it is readable to them any more'

set request.jwt.claim.sub = '2c2c2c2c-2d2d-2e2e-2f2f-202020202020';
do $$ begin
  if not exists (select 1 from product where name = 'Lentejas')
    then raise exception 'FAIL: the pantry went with the person who left'; end if;
  -- Never ownerless: somebody has to be able to invite.
  if not exists (
    select 1 from household_member
     where household_id = (select id from household where name = 'Casa Salida')
       and role = 'owner')
    then raise exception 'FAIL: the household was left with no owner'; end if;
end $$;
\echo '  [3] the pantry stays, and the longest-standing member inherits it'

do $$
declare r jsonb;
begin
  r := leave_household();
  if (r->>'deleted')::boolean then raise exception 'FAIL: deleted while one member remained'; end if;
end $$;
\echo '  [4] the second member leaves, and it still stands'

set request.jwt.claim.sub = '3c3c3c3c-3d3d-3e3e-3f3f-303030303030';
do $$
declare r jsonb;
begin
  r := leave_household();
  if not (r->>'deleted')::boolean then raise exception 'FAIL: the last member left an orphan behind'; end if;
end $$;
\echo '  [5] the last one out takes the household with them'

set role postgres;
do $$ begin
  if exists (select 1 from household where name = 'Casa Salida')
    then raise exception 'FAIL: the household outlived its last member'; end if;
  if exists (select 1 from product where name = 'Lentejas')
    then raise exception 'FAIL: its pantry was left behind, unreachable'; end if;
end $$;
\echo '  [6] and everything in it goes too, rather than becoming unreachable'

set role authenticated;
do $$ begin
  begin
    perform leave_household();
    raise exception 'FAIL: leaving twice was allowed';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;
\echo '  [7] leaving when you are not in one says so'
