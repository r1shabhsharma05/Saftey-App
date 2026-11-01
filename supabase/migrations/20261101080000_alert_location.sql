-- SafeLife 2.0 Day 9 — live position on sos_alerts.
-- The contacts-side alert page needs the alert's latest position in
-- the shared store, not just instance memory: lat/lng at SOS time,
-- refreshed by /location-update, stamped with location_at.
-- Same lockdown as the D3/D4 migrations: RLS enabled, no policies,
-- service_role only — the anon key in the app binary must never read
-- these rows (the page reads through the token-gated route, never
-- PostgREST directly). Idempotent; run in Supabase SQL Editor before
-- the Postgres mirror goes live (same pending step as D3/D4).
alter table public.sos_alerts
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists location_at timestamptz;
