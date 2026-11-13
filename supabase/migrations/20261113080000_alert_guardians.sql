-- SafeLife 2.0 Day 21 — Guardian alert flow on sos_alerts.
-- The notify/accept/location/message state for one alert lives in a
-- single jsonb blob (responses + live pins + preset messages), so a
-- QStash callback or a poll on a different serverless instance can
-- see the same rescue state instead of a same-instance-only memory
-- copy. Same lockdown as the D3/D4/D9/D10 migrations: RLS enabled,
-- no policies, service_role only — the anon key in the app binary
-- must never read these rows (reads go through the API-key /
-- view-token routes).
-- Idempotent; run in Supabase SQL Editor before the Postgres mirror
-- goes live (same pending step as D3/D4/D9/D10/D16/D17/D18/D19).
alter table public.sos_alerts
  add column if not exists guardians jsonb;
