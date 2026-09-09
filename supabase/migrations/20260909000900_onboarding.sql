-- Stockpot :: onboarding preferences
--
-- The preferences table has existed since phase 1 but nothing ever wrote to
-- it, so every plan started from a blank slate. This adds the one column the
-- app needs to know whether the questions have been asked -- an empty answer
-- is a valid answer, so "are the arrays empty" cannot stand in for it.

alter table user_profile
  add column onboarded_at timestamptz;

-- Existing members have already been through signup; do not send them back
-- through a form they never saw.
update user_profile set onboarded_at = created_at where onboarded_at is null;

-- Preferences belong to a person, not a household: two people sharing a
-- pantry can want different things from it.
create or replace function save_preferences(
  p_display_name text default null,
  p_diet_types   text[] default '{}',
  p_cuisines     text[] default '{}',
  p_goals        text[] default '{}',
  p_allergens    text[] default '{}'
)
returns user_profile
language plpgsql
security definer
set search_path = public
as $$
declare profile user_profile;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  insert into user_profile (user_id, display_name, diet_types, cuisines, goals, allergens, onboarded_at)
  values (auth.uid(), p_display_name, p_diet_types, p_cuisines, p_goals, p_allergens, now())
  on conflict (user_id) do update set
    display_name = coalesce(excluded.display_name, user_profile.display_name),
    diet_types   = excluded.diet_types,
    cuisines     = excluded.cuisines,
    goals        = excluded.goals,
    allergens    = excluded.allergens,
    onboarded_at = coalesce(user_profile.onboarded_at, now())
  returning * into profile;

  return profile;
end;
$$;

revoke execute on function save_preferences(text, text[], text[], text[], text[]) from public;
grant  execute on function save_preferences(text, text[], text[], text[], text[]) to authenticated;
