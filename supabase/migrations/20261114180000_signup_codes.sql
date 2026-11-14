-- SafeLife phone-OTP signup — signup_codes table (cross-instance mirror).
--
-- A code issued on one Vercel instance must verify on another, or
-- signup 409s "No verification code pending" for a code the user
-- really received. One row per phone (id = normalized E.164 phone):
-- the salted SHA-256 hash + salt + expiry + attempts, exactly the
-- columns the guardians table mirrors for the same reason. The plain
-- code is never stored, never logged, never returned in any response.
-- The per-hour request ledger is NOT mirrored (soft anti-abuse
-- counter only, same as the guardian flow).
--
-- Same lockdown as D3/D4/D9/D10/D16/D17/D18/D19: RLS enabled, no
-- policies, service_role only — the anon key in the app binary must
-- never read these rows (reads go through the API-key routes).
-- Idempotent; run in Supabase SQL Editor before the Postgres mirror
-- goes live. Until this table exists, the signup-code store logs the
-- failed upsert and degrades to memory-only (same as before).
create table if not exists public.signup_codes (
  id text primary key,
  phone text not null,
  code_hash text,
  code_salt text,
  code_expires_at timestamptz,
  code_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.signup_codes enable row level security;
