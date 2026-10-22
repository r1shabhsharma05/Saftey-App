-- SafeLife — Row Level Security: owner-only access (IDOR fix at the data layer)
--
-- WHY: the mobile app talks to Supabase directly with the publishable anon
-- key (mobile-app/utils/supabase.ts). The anon key is public by design — it
-- ships inside every app binary. Every app query already filters by the
-- signed-in user's id, but without RLS any anon-key holder could read/write
-- ANY row (profiles = name/phone/address/email; emergency_contacts =
-- third-party names + phones). These policies make the database enforce
-- ownership itself: auth.uid() must equal the row owner on every operation.
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).
-- IDEMPOTENT: safe to re-run (each policy is dropped first; ALTER .. ENABLE
-- is a no-op when RLS is already on).

-- ── profiles: one row per auth user, id = auth.users.id ───────────────────
alter table public.profiles enable row level security;

drop policy if exists "profiles_owner_all" on public.profiles;
create policy "profiles_owner_all" on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── emergency_contacts: rows belong to a user via user_id ─────────────────
alter table public.emergency_contacts enable row level security;

drop policy if exists "emergency_contacts_owner_all" on public.emergency_contacts;
create policy "emergency_contacts_owner_all" on public.emergency_contacts
  for all
  -- user_id compared as text so the policy holds whether the column is
  -- uuid or text (the app always writes the auth user's id here).
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- ── avatars bucket: writes confined to the caller's own folder ────────────
-- The app uploads to "<user_id>/avatar.jpg" with upsert:true
-- (mobile-app/app/(tabs)/explore.tsx). These policies let a signed-in user
-- write only inside their own folder.
drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert" on storage.objects
  for insert
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update" on storage.objects
  for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete" on storage.objects
  for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── NOT YET: storage SELECT lockdown ───────────────────────────────────────
-- The avatars bucket is currently public and the app reads photos via
-- getPublicUrl() (mobile-app/app/(tabs)/explore.tsx). Locking SELECT to the
-- owner today would 403 the app's own reads. When the app switches to signed
-- URLs (supabase.storage.from('avatars').createSignedUrl), apply:
--
--   drop policy if exists "avatars_owner_select" on storage.objects;
--   create policy "avatars_owner_select" on storage.objects
--     for select
--     using (
--       bucket_id = 'avatars'
--       and (storage.foldername(name))[1] = auth.uid()::text
--     );
--
-- Until then, avatar URLs stay world-readable by design — documented here so
-- the tradeoff is explicit, not accidental.
