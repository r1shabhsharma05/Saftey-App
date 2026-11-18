-- SafeLife 2.0 Day 27 — Evidence Vault: Postgres mirror of the
-- in-memory chunk registry (Backend/services/evidenceStore.js).
--
-- WHY: the vault hash-chains the registry, and the registry must
-- survive a Vercel instance recycle — a chunk registered on one
-- instance has to be verifiable from any other. Each registered
-- chunk gets one row; the vault reads the rows back in vault order
-- (audio, then video, by index) and hashes the bytes it downloads
-- from the `evidence` Storage bucket.
--
-- Row identity: id = `<alertId>:<kind>:<index>` — the same key the
-- in-memory registry uses, so the fire-and-forget upsert in
-- evidenceStore.register() stays idempotent on the primary key.
-- Same lockdown as the D3/D4/D9/D10 migrations: RLS enabled, no
-- policies, service_role only — the anon key in the app binary must
-- never read these rows (reads go through the API's vault routes,
-- which enforce JWT + owner-only).
--
-- IDEMPOTENT: guarded by if not exists throughout, so re-running is
-- a no-op. Forward-only: never edit an applied migration.
--
-- APPLY: Supabase Management API query endpoint (project: safelife /
-- xkfrsjtfbylhhrvibmxk, ap-south-1) — same as the 20 migrations
-- applied 2026-11-19.

create table if not exists public.evidence_chunks (
  id text primary key,
  alert_id text not null,
  kind text not null check (kind in ('audio', 'video')),
  chunk_index integer not null check (chunk_index >= 0),
  storage_path text not null,
  bytes integer not null check (bytes > 0),
  mime text not null,
  uploaded_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists evidence_chunks_alert_kind_index_uidx
  on public.evidence_chunks (alert_id, kind, chunk_index);

create index if not exists evidence_chunks_alert_idx
  on public.evidence_chunks (alert_id);

alter table public.evidence_chunks enable row level security;
