-- SafeLife 2.0 Day 10 — ACKs + escalation state on sos_alerts.
-- The escalation ladder needs, in the shared store: which distinct
-- contacts acknowledged (hashed keys only — never raw phones or
-- tokens), and the ladder's schedule + callback runs, so a QStash
-- callback on a different serverless instance can see the stop
-- conditions (2 acks, completed steps) instead of re-firing blind.
-- Same lockdown as the D3/D4/D9 migrations: RLS enabled, no policies,
-- service_role only — the anon key in the app binary must never read
-- these rows (reads go through the API-key / view-token routes).
-- Idempotent; run in Supabase SQL Editor before the Postgres mirror
-- goes live (same pending step as D3/D4/D9).
alter table public.sos_alerts
  add column if not exists acks jsonb not null default '[]'::jsonb,
  add column if not exists escalation jsonb;
