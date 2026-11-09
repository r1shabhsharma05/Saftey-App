-- SafeLife 2.0 Day 17 — journey watch columns (deviation / stop /
-- overstay detection → check-in → auto-escalation).
--
-- Mirrors the in-memory D17 watch state so a QStash callback on
-- another serverless instance sees the same prompt, answer, and
-- escalation history a local one would. Without these columns a
-- DB-restored journey reads back as never-moved / never-prompted
-- (the fromRow fallbacks), which is safe but blind: an "I'm OK"
-- answered on one instance would not stand down a timer firing on
-- another. Same lockdown as D16: RLS enabled, no policies,
-- service_role only. Idempotent; run in Supabase SQL Editor before
-- the Postgres mirror goes live (same pending step as D3/D4/D9/D10/D16).
alter table if exists public.journeys
  add column if not exists last_moved_at timestamptz,
  add column if not exists contacts jsonb not null default '[]'::jsonb,
  add column if not exists check_in jsonb,
  add column if not exists last_ok_at timestamptz,
  add column if not exists last_ok_reason text,
  add column if not exists escalation jsonb not null default '{"scheduled":[],"runs":[]}'::jsonb;
