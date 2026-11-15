-- SafeLife — explicit REVOKE on journeys, guardians, signup_codes (audit 4.5-info)
--
-- WHY: these three tables have RLS enabled with no policies (deny-by-default
-- for anon/authenticated), but unlike sos_alerts/audit_events they never got
-- the explicit privilege layer. This is defence-in-depth only: a future
-- careless policy alone cannot expose them, because the roles hold no grant
-- to begin with. Matches the sos_alerts pattern in
-- 20261026080000_sos_alerts_audit.sql exactly.
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).
-- IDEMPOTENT: safe to re-run (REVOKE/GRANT are no-ops when already set).

-- ── journeys ───────────────────────────────────────────────────────────────
revoke all on public.journeys from anon, authenticated;
grant all on public.journeys to service_role;

-- ── guardians ──────────────────────────────────────────────────────────────
revoke all on public.guardians from anon, authenticated;
grant all on public.guardians to service_role;

-- ── signup_codes ───────────────────────────────────────────────────────────
revoke all on public.signup_codes from anon, authenticated;
grant all on public.signup_codes to service_role;
