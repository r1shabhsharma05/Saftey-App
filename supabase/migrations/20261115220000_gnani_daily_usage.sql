-- SafeLife run-3 fix round 2 (6.1/8.1) — shared Gnani daily quota.
--
-- WHY: the per-account daily Gnani counter (50/day) lived in a
-- per-instance in-memory Map (services/voice.js), so a flood spread
-- across Vercel cold starts got 50/day PER INSTANCE. This table is
-- the shared counter: one row per (caller, day), id =
-- `<user:<id>|ip:<ip>>:<YYYY-MM-DD>`, count = calls used. The
-- backend reads the row before a Gnani call and upserts count+1
-- after a call that reached the provider.
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).
-- DO NOT APPLY YET unless the coordinator says so — until applied,
-- the counter fails open to the in-memory Map (logged), with the
-- old per-instance behaviour. IDEMPOTENT: safe to re-run.
-- VERIFY: select count(*) from public.gnani_daily_usage;
--         (0 rows until the first counted call)
--
-- RLS is enabled with no policies (deny-all for anon/authenticated)
-- plus the explicit REVOKE/GRANT layer, matching the login_codes
-- pattern in 20261115080000_run2_owner_proof_ledger.sql: only the
-- service_role key (server-side) can read/write this table.
--
-- NOTE: the increment is read-then-write, not atomic — two
-- concurrent calls can both read N and write N+1, undercounting by
-- one. Accepted: the cap is a cost guard, not a billing boundary.

create table if not exists public.gnani_daily_usage (
  id text primary key,
  user_key text not null,
  day date not null,
  count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists gnani_daily_usage_user_key_day_idx
  on public.gnani_daily_usage (user_key, day);

alter table public.gnani_daily_usage enable row level security;
revoke all on public.gnani_daily_usage from anon, authenticated;
grant all on public.gnani_daily_usage to service_role;
