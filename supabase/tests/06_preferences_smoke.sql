\set ON_ERROR_STOP on
-- Preferences: asked once, editable forever, and an empty answer counts.

insert into auth.users (id) values
  ('0a0a0a0a-0b0b-0c0c-0d0d-0e0e0e0e0e0e'),
  ('1a1a1a1a-1b1b-1c1c-1d1d-1e1e1e1e1e1e');

set role authenticated;
set request.jwt.claim.sub = '0a0a0a0a-0b0b-0c0c-0d0d-0e0e0e0e0e0e';
select id as hh, invite_code from create_household('Casa Prefs', 2) \gset

do $$ begin
  if (select onboarded_at from user_profile where user_id = auth.uid()) is not null
    then raise exception 'FAIL: a new member should not count as onboarded'; end if;
end $$;
\echo '  [1] joining a household does not answer the preference questions'

do $$
declare p user_profile;
begin
  p := save_preferences(null, array['Vegetarian'], array['Italian','Mexican'], array['Waste less']);
  if p.onboarded_at is null then raise exception 'FAIL: onboarded_at was not stamped'; end if;
  if p.diet_types <> array['Vegetarian'] then raise exception 'FAIL: diets not saved'; end if;
  if array_length(p.cuisines, 1) <> 2 then raise exception 'FAIL: cuisines not saved'; end if;
end $$;
\echo '  [2] answering saves the preferences and stamps onboarded_at'

-- Skipping is still an answer, or the question is asked again on every launch.
set request.jwt.claim.sub = '1a1a1a1a-1b1b-1c1c-1d1d-1e1e1e1e1e1e';
-- The code has to come from the first member: RLS means the joiner cannot
-- read the household until they are in it.
\o /dev/null
select join_household(:'invite_code');
\o
do $$
declare p user_profile;
begin
  p := save_preferences();
  if p.onboarded_at is null then raise exception 'FAIL: skipping must still count as onboarded'; end if;
  if array_length(p.diet_types, 1) is not null then raise exception 'FAIL: skipping should leave diets empty'; end if;
end $$;
\echo '  [3] skipping counts as answered, with empty preferences'

-- Editing later must not reset when the questions were first answered.
do $$
declare before_stamp timestamptz; after_stamp timestamptz; p user_profile;
begin
  select onboarded_at into before_stamp from user_profile where user_id = auth.uid();
  perform pg_sleep(0.01);
  p := save_preferences(null, array['Keto'], '{}', array['Lose weight']);
  after_stamp := p.onboarded_at;
  if after_stamp <> before_stamp then raise exception 'FAIL: editing reset onboarded_at'; end if;
  if p.diet_types <> array['Keto'] then raise exception 'FAIL: the edit did not stick'; end if;
end $$;
\echo '  [4] editing later replaces the answers but keeps the original stamp'

-- Preferences are personal, even inside a shared household.
do $$ begin
  if (select count(*) from user_profile) <> 1
    then raise exception 'FAIL: a member can read another member''s preferences'; end if;
  if (select diet_types from user_profile) <> array['Keto']
    then raise exception 'FAIL: the wrong profile is visible'; end if;
end $$;
\echo '  [5] two people sharing a pantry keep separate preferences'
