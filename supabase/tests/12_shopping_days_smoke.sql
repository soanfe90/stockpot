\set ON_ERROR_STOP on
-- Shopping days on the profile: a real answer about a household, including
-- the answer "never".

insert into auth.users (id) values ('6f6f6f6f-6060-6161-6262-636363636363');

set role authenticated;
set request.jwt.claim.sub = '6f6f6f6f-6060-6161-6262-636363636363';
select id as hh from create_household('Casa Sábado', 2) \gset

do $$
declare p user_profile;
begin
  p := save_preferences();
  if p.shopping_days <> array[6]
    then raise exception 'FAIL: the default should be Saturday, got %', p.shopping_days; end if;
end $$;
\echo '  [1] shopping days default to Saturday'

do $$
declare p user_profile;
begin
  p := save_preferences(null, '{}', '{}', '{}', '{}', null, array[2, 5]);
  if p.shopping_days <> array[2, 5] then raise exception 'FAIL: shopping days not saved'; end if;
end $$;
\echo '  [2] two days a week is saved as given'

do $$
declare p user_profile;
begin
  -- Never shopping is an answer, not a blank. A plan for this household comes
  -- entirely from stock, and the column has to be able to say so.
  p := save_preferences(null, '{}', '{}', '{}', '{}', null, '{}');
  if array_length(p.shopping_days, 1) is not null
    then raise exception 'FAIL: an empty answer was not kept'; end if;
end $$;
\echo '  [3] never shopping is a valid answer, not a missing one'

do $$
declare p user_profile;
begin
  p := save_preferences(null, '{}', '{}', '{}', '{}', null, array[1, 4]);
  -- Editing something else must not quietly rewrite the week.
  p := save_preferences(null, array['Vegan'], '{}', '{}', '{}');
  if p.shopping_days <> array[1, 4]
    then raise exception 'FAIL: a diet edit reset the shopping days to %', p.shopping_days; end if;
  if (p.meal_times->>'lunch')::int <> 780
    then raise exception 'FAIL: mealtimes were disturbed too'; end if;
end $$;
\echo '  [4] saving other preferences leaves them untouched'

do $$ begin
  begin
    perform save_preferences(null, '{}', '{}', '{}', '{}', null, array[0, 9]);
    raise exception 'FAIL: a day outside Monday-Sunday was accepted';
  exception when check_violation then null;
  end;
end $$;
\echo '  [5] a weekday outside 1-7 is refused'

-- ----------------------------------------------------------- model choice ---

do $$
declare p user_profile;
begin
  p := save_preferences();
  if p.llm_model is not null
    then raise exception 'FAIL: the default should defer to the server, got %', p.llm_model; end if;

  p := save_preferences(null, '{}', '{}', '{}', '{}', null, null, 'gemini-2.5-pro');
  if p.llm_model <> 'gemini-2.5-pro' then raise exception 'FAIL: the model was not saved'; end if;

  -- And editing something else does not quietly send them back to flash.
  p := save_preferences(null, array['Vegan'], '{}', '{}', '{}');
  if p.llm_model <> 'gemini-2.5-pro' then raise exception 'FAIL: a diet edit reset the model'; end if;
end $$;
\echo '  [6] the model is a preference, kept across other edits'

do $$ begin
  begin
    perform save_preferences(null, '{}', '{}', '{}', '{}', null, null, 'gpt-4');
    raise exception 'FAIL: an arbitrary model name was accepted';
  exception when check_violation then null;
  end;
end $$;
\echo '  [7] a model outside the allowlist is refused'

-- ------------------------------------------------------- meals per day ---

do $$
declare p user_profile;
begin
  p := save_preferences();
  if p.planned_meals <> array['breakfast', 'lunch', 'dinner']
    then raise exception 'FAIL: three meals a day should be the default, got %', p.planned_meals; end if;

  -- Two meals a day is an ordinary answer, and snacks are opt-in.
  p := save_preferences(null, '{}', '{}', '{}', '{}', null, null, null, array['lunch', 'dinner']);
  if p.planned_meals <> array['lunch', 'dinner'] then raise exception 'FAIL: planned meals not saved'; end if;

  p := save_preferences(null, array['Vegan'], '{}', '{}', '{}');
  if p.planned_meals <> array['lunch', 'dinner']
    then raise exception 'FAIL: a diet edit reset the meals to %', p.planned_meals; end if;
end $$;
\echo '  [8] which meals to plan is a preference, kept across other edits'

do $$ begin
  begin
    perform save_preferences(null, '{}', '{}', '{}', '{}', null, null, null, '{}');
    raise exception 'FAIL: a plan of no meals at all was accepted';
  exception when check_violation then null;
  end;
end $$;
\echo '  [9] but planning no meals at all is not one'
