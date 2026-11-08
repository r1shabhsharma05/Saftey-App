-- SafeLife — RLS privilege hardening (audit NV6)
--
-- WHY: the owner-only policies in 20261022120000_rls_owner_only.sql
-- gate rows by auth.uid(), but the anon/authenticated roles still hold
-- blanket table privileges, so a policy gap (or a future policy edit)
-- would silently expose rows. This migration is the second layer:
-- anon gets nothing, authenticated gets only the CRUD the app needs,
-- and RLS still decides WHICH rows each operation touches.
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).
-- IDEMPOTENT: safe to re-run (REVOKE/GRANT are no-ops when already set).

-- ── profiles: one row per auth user, id = auth.users.id ───────────────────
revoke all on public.profiles from anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

-- ── emergency_contacts: rows belong to a user via user_id ─────────────────
revoke all on public.emergency_contacts from anon, authenticated;
grant select, insert, update, delete on public.emergency_contacts to authenticated;
