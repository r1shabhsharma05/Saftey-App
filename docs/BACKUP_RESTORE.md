# SafeLife backup + test-restore procedure (H7)

Backups are a dashboard procedure, not code. Nothing in this file
executes a backup — it tells Rishabh (or the parent agent) exactly
where to click, what to check, and how to prove a restore works
before it is ever needed.

Project: Supabase **safelife** (`xkfrsjtfbylhhrvibmxk`, ap-south-1).

## 1. What Supabase backs up, on which plan

Confirm the current plan in the dashboard first — plans change, and
this file must not be trusted over the dashboard:

1. Supabase dashboard → project `safelife` → Settings → Billing /
   Usage — note the plan (Free / Pro).
2. Database → Backups — note what is listed: backup frequency and
   retention shown there are the truth.

Known at time of writing (verify in the dashboard, do not assume):

- **Free plan:** daily backups, short retention (days, not weeks).
  No point-in-time recovery (PITR).
- **Pro plan:** daily backups with longer retention, plus PITR as a
  paid add-on (restore to any minute within the retention window).
- Either way, backups cover the **database** (all tables, including
  `profiles`, `emergency_contacts`, `sos_alerts`, `guardians`,
  `journeys`, `signup_codes`, `login_codes`, `gnani_daily_usage`).
  They do **not** cover Supabase Auth users separately from the
  database, nor Storage objects — see §2.

## 2. What the Supabase backup does NOT cover

- **Storage (`avatars` bucket):** profile photos are objects, not
  rows. A database restore does not bring back deleted photos.
  Mitigation: keep a periodic copy of the bucket. In the dashboard:
  Storage → `avatars` → download, or use the Supabase CLI /
  Storage API to mirror the bucket to local disk on a schedule.
  Record the mirror date in the run log.
- **Auth users (`auth.users`):** restored with the database on a
  full-project restore, but a table-level restore does not touch
  them. If profiles are restored without their matching auth
  users, `profiles.id` points at users that do not exist and login
  breaks. Prefer full-project restores; if a table-level restore
  is unavoidable, verify auth users first (§5).
- **Environment variables / secrets:** Vercel env, EAS env, and
  provider consoles are not in any Supabase backup. Secrets live
  in `SECRET_ROTATION.md`, not here.
- **Migrations not yet applied:** the backup holds data, not the
  repo's migration files. The repo is the source of truth for
  schema; the backup is the source of truth for data.

## 3. Taking a backup (dashboard)

Scheduled backups run automatically on the plan (§1). Take a manual
backup before any risky operation (migration that drops a column,
bulk `UPDATE`/`DELETE`, rollback):

1. Supabase dashboard → Database → Backups → **take a backup**
   (or confirm the latest scheduled backup's timestamp is after
   your last good state).
2. Record in the run log: backup time, what operation it precedes,
   and the row counts from §5 taken at the same time.
3. For an extra safety copy before a destructive change, also take
   a logical dump from a local machine with the database password
   (never the service_role key — that is not a Postgres password):
   `pg_dump` against the project's Postgres connection string
   (Settings → Database → Connection string). Store the dump
   outside the repo, never in git.

## 4. Test-restore procedure (do this before you ever need it)

A backup that has never been restored is a hope, not a backup.
Test on a **throwaway project**, never on live:

1. Supabase dashboard → create a new project (free tier is fine)
   named `safelife-restore-test-<date>`. Note its ref.
2. Restore into it:
   - **Full backup restore:** Database → Backups in the *live*
     project → restore to the test project (if the dashboard
     offers cross-project restore), **or**
   - **Logical dump:** `psql` the `pg_dump` file from §3 into the
     test project's database.
3. Apply the repo's migrations to the test project in order
   (`supabase/migrations/`, oldest first) **only if** the dump did
   not already include the schema — a full dump includes it; a
   data-only dump does not. Do not apply a migration twice.
4. Run the §5 verification queries against the test project.
5. Point a test backend (Preview deployment, never Production) at
   the test project and confirm: login works, profile loads,
   emergency contacts list loads, an SOS alert persists.
6. Record the result (pass/fail, time taken) in the run log.
7. **Delete the throwaway project afterwards.** It holds a copy of
   real user data — leaving it around is a second live database
   with no monitoring. Deletion is in Settings → General → Delete
   project.

Cadence: test-restore once per quarter, and after any plan change
(Free → Pro) or any migration that changes a table the app reads on
every launch (`profiles`, `emergency_contacts`).

## 5. Verification queries (run on the restored copy, then on live after a real restore)

```sql
-- RLS still on everywhere it matters
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
and tablename in ('profiles','emergency_contacts','sos_alerts',
  'guardians','journeys','signup_codes','login_codes',
  'gnani_daily_usage');
-- expect: every row rowsecurity = t

-- Policies still present
select tablename, policyname from pg_policies
where schemaname = 'public'
order by tablename, policyname;
-- expect: profiles_owner_all, emergency_contacts_owner_all, plus
-- the deny-all posture (no policies) on sos_alerts / login_codes /
-- gnani_daily_usage

-- Row counts match the pre-restore counts recorded in the run log
select 'profiles' as t, count(*) from public.profiles
union all select 'emergency_contacts', count(*) from public.emergency_contacts
union all select 'sos_alerts', count(*) from public.sos_alerts
union all select 'guardians', count(*) from public.guardians
union all select 'journeys', count(*) from public.journeys
union all select 'signup_codes', count(*) from public.signup_codes
union all select 'login_codes', count(*) from public.login_codes
union all select 'gnani_daily_usage', count(*) from public.gnani_daily_usage;
-- expect: counts equal the counts taken before the restore (a restore
-- to an older backup legitimately shows older counts — that is the
-- point of recording the backup's own timestamp alongside)

-- No orphaned profiles (profile without an auth user)
select count(*) from public.profiles p
where not exists (select 1 from auth.users u where u.id = p.id);
-- expect: 0. Anything above 0 means the restore brought profiles
-- without their auth users — fix before going live.
```

## 6. Real restore (incident) — order of operations

1. Stop the bleeding first: if bad data is still being written,
   stop the writer (disable the route / redeploy backend with the
   writer off) before restoring, or the restore is immediately
   re-polluted.
2. Take a backup of the *current* (broken) state first — a restore
   is destructive, and the broken state may hold rows written
   after the last good backup that someone will want back.
3. Restore the last good backup (dashboard → Database → Backups →
   Restore, or PITR to a timestamp if on Pro + PITR).
4. Run §5 against live. Do not re-enable the writer until §5 passes.
5. Re-enable, then verify end-to-end on a test phone (login,
   profile, contacts, test alert).
6. Log: what was restored, from which backup/timestamp, row
   counts before/after, and what data (if any) written between
   backup and incident is permanently lost. Tell affected users
   honestly if their data was in that window.
