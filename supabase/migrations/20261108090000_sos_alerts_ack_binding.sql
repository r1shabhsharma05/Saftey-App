-- SafeLife audit fixes (2026-11-08) — SOS-time stored fields on sos_alerts.
--
-- H3 ACK binding: contact_keys holds the one-way hashes of the contacts
-- the SOS actually went to (computed at SOS time, never raw phones).
-- Only those identifiers count toward the 2-ack escalation stop; an
-- identifier outside the set is rejected at POST /alert/:id/ack.
-- Empty for legacy rows — the lifecycle treats an empty set as unbound.
--
-- L5 delivery-retry binding: sos_message / sos_contacts hold the exact
-- message + contacts the SOS was first sent with, so a retry re-sends
-- the stored original instead of trusting body-supplied text.
-- retry_consumed lists the retry attempts already used (single-use
-- tokens): attempt numbers, e.g. '{1,2}'.
--
-- Same lockdown as the D3/D4/D9/D10 migrations: RLS enabled, no
-- policies, service_role only — the anon key in the app binary must
-- never read these rows (reads go through the API-key / view-token
-- routes). Idempotent; run in Supabase SQL Editor.
alter table public.sos_alerts
  add column if not exists contact_keys text[] not null default '{}',
  add column if not exists sos_message text,
  add column if not exists sos_contacts jsonb not null default '[]'::jsonb,
  add column if not exists retry_consumed integer[] not null default '{}';
