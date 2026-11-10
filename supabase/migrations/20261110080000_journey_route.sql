-- SafeLife 2.0 Day 18 — journey route polyline (deviation measured
-- against the road actually walked, not the straight line).
--
-- The Day-18 real-area probe proved the straight line false-prompts
-- on real roads: the live OSRM route GLA University → Mathura
-- Junction wanders 3,073 m off the straight line, 411 of 483
-- vertices past the 500 m threshold. The app sends the OSRM polyline
-- at create time (mobile-app/utils/journey.ts); the watch measures
-- deviation against it, falling back to the straight line when the
-- column is empty (pre-D18 rows, or a create whose /route fetch
-- failed). Same lockdown as D16/D17: RLS enabled, no policies,
-- service_role only. Idempotent; run in Supabase SQL Editor before
-- the Postgres mirror goes live (same pending step as D3/D4/D9/D10/D16/D17).
alter table if exists public.journeys
  add column if not exists route jsonb not null default '[]'::jsonb;
