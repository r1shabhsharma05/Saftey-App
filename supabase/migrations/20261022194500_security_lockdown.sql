-- SafeLife — security lockdown (applied live 2026-10-22, Rishabh's order)
--
-- WHY: this Supabase project is SHARED. Alongside SafeLife's own tables it
-- hosts SecureGaurd's Prisma tables (User, Scan, Vulnerability, ...). Those
-- tables had RLS disabled and anon/authenticated grants, so ANY holder of
-- SafeLife's public anon key (it ships inside the app binary) could read
-- them through PostgREST — including SecureGaurd's User table with password
-- hashes and password-reset tokens. Verified live before this fix:
-- anon SELECT on User/Scan/Organization/Vulnerability returned real rows.
--
-- WHAT THIS DOES:
-- 1. Enables RLS with NO policies on the 12 SecureGaurd tables. PostgREST
--    (anon + authenticated) is then deny-all. SecureGaurd's backend is
--    unaffected: Prisma connects directly as the table owner, which
--    bypasses RLS. Verified after applying: anon reads return 0 rows,
--    service_role reads fine, SecureGaurd /health stays ok.
-- 2. Locks the avatars bucket down (completes the step the 20261022120000
--    migration deliberately deferred): drops the public SELECT policy,
--    adds an owner-only SELECT policy, and flips the bucket to private.
--    The app now stores the storage PATH in profiles.avatar_url and
--    displays photos via createSignedUrl (explore.tsx). Existing rows
--    that still hold a legacy public URL are rewritten to path form.
--
-- IDEMPOTENT: safe to re-run.

-- ── 1. SecureGaurd tables: RLS on, no PostgREST access ────────────────────
alter table public."User" enable row level security;
alter table public."Organization" enable row level security;
alter table public."OrganizationInvitation" enable row level security;
alter table public."OrganizationMembership" enable row level security;
alter table public."Repository" enable row level security;
alter table public."Scan" enable row level security;
alter table public."Vulnerability" enable row level security;
alter table public."Sbom" enable row level security;
alter table public."ComplianceReport" enable row level security;
alter table public."AuditLog" enable row level security;
alter table public."Subscription" enable row level security;
alter table public."StripeWebhookEvent" enable row level security;

-- ── 2. Avatars: owner-only reads, bucket private ───────────────────────────
drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_owner_read" on storage.objects;
create policy "avatars_owner_read" on storage.objects
  for select
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

update storage.buckets set public = false where id = 'avatars';

-- ── 3. Legacy avatar_url rows: public URL -> storage path ──────────────────
update public.profiles
set avatar_url = split_part(regexp_replace(avatar_url, '^.*/avatars/', ''), '?', 1)
where avatar_url like 'http%';
