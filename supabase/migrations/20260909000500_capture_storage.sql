-- Stockpot :: storage for capture images
--
-- Photos live at `<household_id>/<capture_id>.jpg` in a private bucket, so the
-- first path segment is the tenancy check. Wrapped in a guard because the
-- storage schema only exists on Supabase -- against a plain Postgres (as in
-- supabase/tests) this migration is a no-op.

do $$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'storage schema absent -- skipping capture bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('captures', 'captures', false, 10485760,
          array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
  on conflict (id) do update
    set file_size_limit   = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute $pol$
    create policy "captures readable by household" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'captures'
        and is_household_member(((storage.foldername(name))[1])::uuid)
      );
  $pol$;

  execute $pol$
    create policy "captures writable by household" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'captures'
        and is_household_member(((storage.foldername(name))[1])::uuid)
      );
  $pol$;

  execute $pol$
    create policy "captures removable by household" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'captures'
        and is_household_member(((storage.foldername(name))[1])::uuid)
      );
  $pol$;

exception
  when duplicate_object then
    raise notice 'capture storage policies already present';
end $$;
