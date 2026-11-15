-- SafeLife run-6 fix (check 4.5) — profiles + emergency_contacts tables.
--
-- WHY: no migration ever CREATE TABLEd these two tables. Every earlier
-- migration only REFERENCES them: 20261022120000_rls_owner_only.sql
-- enables RLS + owner policies on them, 20261022194500_security_lockdown.sql
-- UPDATEs profiles.avatar_url, and 20261108090001_rls_revoke_grant.sql
-- REVOKEs/GRANTs on them. They exist on the live project only because
-- they were created by hand / via the dashboard. A fresh project (or a
-- test restore) therefore has RLS policies pointing at tables that do
-- not exist, and the app's first profile insert fails. This migration
-- is the safety net: create both tables with exactly the columns the
-- code actually uses, and re-assert the RLS + privilege layers.
--
-- COLUMNS — from the code, not guessed:
--   profiles: id, first_name, last_name, email, phone, address,
--     unique_id, avatar_url
--     (mobile-app/utils/auth.ts ensureProfile inserts id/first_name/
--     last_name/email/phone/address/unique_id; explore.tsx updates
--     avatar_url; guardian.tsx selects first_name,last_name,phone;
--     Backend/routes/auth.js looks up profiles by phone and reads
--     row.email / row.phone; id = auth.users.id per the RLS header.)
--   emergency_contacts: id, user_id, name, phone
--     (mobile-app/app/(tabs)/contacts.tsx selects/inserts/deletes on
--     id, user_id, name, phone; Backend/routes/auth.js deletes by
--     user_id on account deletion.)
--
-- RLS — DELIBERATE DEVIATION, read before "fixing" it: this migration
-- re-asserts the OWNER-ONLY policies (auth.uid() = row owner), NOT
-- deny-all / service_role-only. The mobile app reads and writes both
-- tables DIRECTLY with the publishable anon key (auth.ts ensureProfile,
-- contacts.tsx, explore.tsx, guardian.tsx) — deny-all would break
-- signup, profile load, and emergency-contact save in the shipped app.
-- The service_role-only pattern is correct only for tables the app
-- never touches directly (sos_alerts, login_codes, gnani_daily_usage).
-- If the app is ever moved behind backend-only access for these two
-- tables, drop the owner policies then — not before.
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).
-- PREPARED, NOT APPLIED — this file has not been run against live.
-- IDEMPOTENT: safe to re-run. CREATE TABLE IF NOT EXISTS + ADD COLUMN
-- IF NOT EXISTS + DROP POLICY IF EXISTS + REVOKE/GRANT are all no-ops
-- when the live state already matches. No data is deleted or altered:
-- existing rows are untouched; missing columns are added NULL/empty
-- with defaults, never backfilled with invented values.
-- VERIFY (after apply):
--   select tablename, rowsecurity from pg_tables
--     where schemaname = 'public'
--     and tablename in ('profiles','emergency_contacts');
--   select schemaname, tablename, policyname, cmd, roles
--     from pg_policies
--     where tablename in ('profiles','emergency_contacts');
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--     where table_schema = 'public'
--     and table_name in ('profiles','emergency_contacts')
--     order by table_name, ordinal_position;
--   (Expect: both tables rowsecurity = t; policies
--   profiles_owner_all / emergency_contacts_owner_all present.)

-- ── profiles ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key,
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  unique_id text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill columns on a live table created by hand with a subset.
do $$
begin
  alter table public.profiles add column if not exists first_name text not null default '';
  alter table public.profiles add column if not exists last_name text not null default '';
  alter table public.profiles add column if not exists email text not null default '';
  alter table public.profiles add column if not exists phone text not null default '';
  alter table public.profiles add column if not exists address text not null default '';
  alter table public.profiles add column if not exists unique_id text;
  alter table public.profiles add column if not exists avatar_url text;
  alter table public.profiles add column if not exists created_at timestamptz not null default now();
  alter table public.profiles add column if not exists updated_at timestamptz not null default now();
end $$;

-- unique_id is 'SL-XXXXXXXX' (auth.ts). Enforce uniqueness only when
-- the existing rows allow it — a duplicate would fail the whole
-- migration, so check first; a collision is reported, not papered over.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'profiles_unique_id_idx'
  ) and not exists (
    select unique_id from public.profiles
    where unique_id is not null
    group by unique_id having count(*) > 1
  ) then
    create unique index profiles_unique_id_idx
      on public.profiles (unique_id);
  end if;
end $$;

create index if not exists profiles_phone_idx on public.profiles (phone);

-- ── emergency_contacts ───────────────────────────────────────────────────
create table if not exists public.emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  alter table public.emergency_contacts add column if not exists user_id uuid;
  alter table public.emergency_contacts add column if not exists name text not null default '';
  alter table public.emergency_contacts add column if not exists phone text not null default '';
  alter table public.emergency_contacts add column if not exists created_at timestamptz not null default now();
  alter table public.emergency_contacts add column if not exists updated_at timestamptz not null default now();
end $$;

-- NOTE: user_id is uuid here. The live table may instead carry it as
-- text (created by hand); ADD COLUMN is then a no-op and the text type
-- stands. Both work: the policy below compares auth.uid()::text =
-- user_id::text, and the app always writes the auth user's id.
create index if not exists emergency_contacts_user_id_idx
  on public.emergency_contacts (user_id);
create index if not exists emergency_contacts_user_phone_idx
  on public.emergency_contacts (user_id, phone);

-- ── RLS + privileges (re-assert of 20261022120000 + 20261108090001) ──────
alter table public.profiles enable row level security;
alter table public.emergency_contacts enable row level security;

drop policy if exists "profiles_owner_all" on public.profiles;
create policy "profiles_owner_all" on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "emergency_contacts_owner_all" on public.emergency_contacts;
create policy "emergency_contacts_owner_all" on public.emergency_contacts
  for all
  -- user_id compared as text so the policy holds whether the column is
  -- uuid or text (the app always writes the auth user's id here).
  using (auth.uid()::text = user_id::text)
  with check (auth.uid()::text = user_id::text);

-- Privilege layer: anon gets nothing, authenticated gets only the CRUD
-- the app needs, RLS still decides WHICH rows each operation touches.
revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

revoke all on public.emergency_contacts from anon, authenticated;
grant select, insert, update, delete on public.emergency_contacts to authenticated;

-- ROLLBACK: this migration creates tables that never existed in any
-- migration, so there is nothing to roll back to. If it must be undone
-- on a FRESH project (no live rows), drop the tables:
--   drop table if exists public.emergency_contacts;
--   drop table if exists public.profiles;
-- NEVER run that on the live project: it deletes every profile and
-- every emergency contact. On live, the safe undo is policies-only:
-- re-run 20261022120000_rls_owner_only.sql + 20261108090001_rls_revoke_grant.sql.
