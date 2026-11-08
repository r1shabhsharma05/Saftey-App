-- SafeLife 2.0 Day 16 — journeys table for Journey Guardian.
-- The shared store for trips: origin, destination (+label), expected
-- arrival, and the live pin, so a QStash callback or a different
-- serverless instance can see the trip D17's overdue check watches
-- (the in-memory store alone cannot). No contact list is stored —
-- D16 shares via a signed link the traveller sends; D17's escalation
-- job will carry the contacts in its own body when it schedules the
-- overdue check. Same lockdown as the D3/D4/D9/D10 migrations: RLS
-- enabled, no policies, service_role only — the anon key in the app
-- binary must never read these rows (reads go through the API-key /
-- view-token routes). Idempotent; run in Supabase SQL Editor before
-- the Postgres mirror goes live (same pending step as D3/D4/D9/D10).
create table if not exists public.journeys (
  id uuid primary key,
  state text not null check (state in ('active', 'arrived', 'cancelled')),
  user_name text not null default '',
  origin_lat double precision not null,
  origin_lng double precision not null,
  dest_lat double precision not null,
  dest_lng double precision not null,
  destination_label text not null,
  expected_arrival_at timestamptz not null,
  last_lat double precision,
  last_lng double precision,
  location_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.journeys enable row level security;
