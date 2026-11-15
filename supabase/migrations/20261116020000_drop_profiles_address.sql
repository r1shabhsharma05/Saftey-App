-- SafeLife fix round 5 — H6: stop collecting address.
--
-- WHY: nothing in the app collects an address any more. The only
-- writer was mobile-app/utils/auth.ts ensureProfile (dropped in the
-- same change) and the only reader was the Live Location card
-- subtitle in mobile-app/app/(tabs)/index.tsx (now a static
-- 'Current Zone'). The column was created by the already-applied
-- 20261116013000_profiles_emergency_contacts.sql — that file is
-- never edited; this forward-only migration drops the column.
--
-- IDEMPOTENT: guarded by information_schema, so re-running is a
-- no-op. Dropping the column also drops its default; no data worth
-- keeping lived here (the column was always '' — nothing ever
-- wrote a real address into it).
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'address'
  ) then
    alter table public.profiles drop column address;
  end if;
end $$;
