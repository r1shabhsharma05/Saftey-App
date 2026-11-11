-- SafeLife 2.0 Day 19 — guardians table for Guardian Network onboarding
-- (plan §6 D19, plan §3 F2).
--
-- One row per guardian: a verified app user who can be called on when
-- someone nearby needs help. Cold-start per plan §7.5: guardians are
-- the user's own trusted people (family/friends) first.
--
-- The verification code IS mirrored here (salted SHA-256 hash + salt +
-- expiry + attempts) so a verify landing on a different Vercel
-- instance can still succeed — the 5-attempt limit is enforced by
-- the store, not by hash secrecy, and the hash is a salted 6-digit
-- code, not a password. The per-hour request ledger is NOT mirrored
-- (soft anti-abuse counter only). The plain code is never stored,
-- never logged, never returned in any response.
--
-- Same lockdown as D3/D4/D9/D10/D16/D17/D18: RLS enabled, no policies,
-- service_role only — the anon key in the app binary must never read
-- these rows (reads go through the API-key routes). Idempotent; run
-- in Supabase SQL Editor before the Postgres mirror goes live (same
-- pending step as D3/D4/D9/D10/D16/D17/D18).
create table if not exists public.guardians (
  id uuid primary key,
  user_id text not null,
  name text not null,
  phone text not null unique,
  role text not null check (role in ('family', 'friend', 'volunteer', 'security')),
  state text not null check (state in ('pending', 'verified')),
  available boolean not null default false,
  verified_at timestamptz,
  code_hash text,
  code_salt text,
  code_expires_at timestamptz,
  code_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.guardians enable row level security;
