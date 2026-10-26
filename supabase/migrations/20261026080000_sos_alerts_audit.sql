-- SafeLife 2.0 Day 3 — SOS alert lifecycle + Postgres audit log.
--
-- WHY: until now an SOS existed only as a Telegram send and a stdout
-- audit line. D3 gives every alert a durable record (state machine:
-- created → dispatching → delivered/acked/closed + failed) and moves the
-- audit trail into a queryable table, so D4's delivery engine and D5's
-- delivery-status UI have something to read — and a failed alert can no
-- longer vanish silently.
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).
-- IDEMPOTENT: safe to re-run (CREATE TABLE IF NOT EXISTS; the backend
-- writes with the service_role key, which bypasses RLS).
--
-- SECURITY (same precedent as the 2026-10-22 lockdown migration):
-- RLS is enabled on both tables with NO policies, and anon/authenticated
-- grants are revoked outright. PostgREST then denies the public anon key
-- (which ships inside every app binary) completely. Only the backend's
-- service_role key — server-side, never in the app — can write. The
-- backend's audit lines carry no PII by construction (fingerprint, counts,
-- alert id only), so audit_events is safe to retain.
--
-- NOTE on audit_events.alert_id: a plain uuid column, deliberately NOT a
-- foreign key. Audit must survive even if the alert row is absent, and
-- most audit actions (api_key.rejected, test_alert.denied) have no alert
-- at all. Referential integrity here would make the audit trail fragile.

-- ── sos_alerts: one row per SOS, current lifecycle state ────────────────
create table if not exists public.sos_alerts (
  id uuid primary key,
  state text not null,
  sent integer not null default 0,
  failed integer not null default 0,
  contacts_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sos_alerts enable row level security;
revoke all on public.sos_alerts from anon, authenticated;
grant all on public.sos_alerts to service_role;

-- ── audit_events: queryable mirror of the stdout audit trail ───────────
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  action text not null,
  actor text not null,
  ip text,
  alert_id uuid,
  meta jsonb
);

alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
grant all on public.audit_events to service_role;

-- Lookup index: alert history reconstruction (D4/D5 read this per alert).
create index if not exists audit_events_alert_id_idx
  on public.audit_events (alert_id);
