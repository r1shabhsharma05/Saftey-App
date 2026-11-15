-- SafeLife run-2 security fixes (2026-11-15) — ownership, ledger + proof mirror, login codes.
--
-- Apply in Supabase SQL Editor before the Day-30 re-ship. Idempotent;
-- until applied, the new columns are absent and the affected mirrors
-- fail closed to memory-only (logged), with no behavior change on the
-- happy path. RLS is already enabled on these tables with no policies
-- (deny-all for anon/authenticated); new columns inherit that.
-- The new login_codes table gets the same lockdown as signup_codes.

-- 3.1: owner id on the two record stores (guardians already carries
-- user_id as its owner — no new column there).
alter table public.sos_alerts add column if not exists owner_id text;
alter table public.journeys add column if not exists owner_id text;

-- R1d: per-hour request ledger, mirrored (timestamps only, never codes).
alter table public.signup_codes add column if not exists code_requests jsonb not null default '[]'::jsonb;
alter table public.guardians add column if not exists code_requests jsonb not null default '[]'::jsonb;

-- R1h: login-code mirror, same shape as signup_codes (one row per
-- phone, id = normalized E.164 phone). The plain code is never stored.
create table if not exists public.login_codes (
  id text primary key,
  phone text not null,
  code_hash text,
  code_salt text,
  code_expires_at timestamptz,
  code_attempts integer not null default 0,
  code_requests jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.login_codes enable row level security;
revoke all on public.login_codes from anon, authenticated;
grant all on public.login_codes to service_role;

-- R1c: single-use signup proof (hash + expiry; the plain proof is
-- never stored).
alter table public.signup_codes add column if not exists proof_hash text;
alter table public.signup_codes add column if not exists proof_expires_at timestamptz;
