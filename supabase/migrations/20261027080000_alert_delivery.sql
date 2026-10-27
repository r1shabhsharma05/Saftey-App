-- SafeLife 2.0 Day 4 — delivery receipts on sos_alerts.
-- Per-channel receipts (services/delivery.js) + the last retry-schedule
-- outcome. Same lockdown as the D3 migration: RLS enabled, no policies,
-- service_role only — the anon key in the app binary must never read
-- these rows. Idempotent; run in Supabase SQL Editor before the
-- Postgres mirror goes live (same pending step as the D3 migration).
alter table public.sos_alerts
  add column if not exists delivery jsonb not null default '[]'::jsonb,
  add column if not exists retry jsonb;
