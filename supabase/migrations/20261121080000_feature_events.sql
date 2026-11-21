-- SafeLife 2.0 Day 29 — ML v1 feature log (plan §3 F7).
--
-- WHY: F7 orders anonymised feature logging from day one — that log
-- is model v2's training data. One row per SOS / journey /
-- risk-score call, written fire-and-forget by
-- Backend/services/featureLog.js.
--
-- PRIVACY BY CONSTRUCTION: there is deliberately NO user_id, NO
-- alert_id, NO phone/name column, and coordinates exist only as a
-- ~1.1 km grid cell (lat/lng rounded to 2 dp server-side). A row
-- cannot be tied back to a person; there is nothing to leak.
--
-- Same lockdown as the D3/D27 migrations: RLS enabled, no policies,
-- service_role only — the anon key in the app binary must never read
-- these rows (nothing reads them over HTTP at all; they are training
-- data, read offline by the owner).
--
-- IDEMPOTENT: guarded by if not exists throughout, so re-running is
-- a no-op. Forward-only: never edit an applied migration.
--
-- APPLY: Supabase Management API query endpoint (project: safelife /
-- xkfrsjtfbylhhrvibmxk, ap-south-1) — same as the 21 migrations
-- applied through 2026-11-19.

create table if not exists public.feature_events (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('sos', 'journey', 'risk_score')),
  cell_lat numeric,
  cell_lng numeric,
  features jsonb not null default '{}'::jsonb,
  score integer not null check (score >= 0 and score <= 100),
  band text not null check (band in ('LOW', 'MODERATE', 'HIGH')),
  model_version text not null,
  ts timestamptz not null default now()
);

create index if not exists feature_events_kind_ts_idx
  on public.feature_events (kind, ts desc);

alter table public.feature_events enable row level security;
