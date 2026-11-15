# SafeLife rollback procedure (H13)

When a release is bad, roll back — do not hot-fix forward on a live
safety app unless the fix is already tested. Rollback is three separate
surfaces (backend, mobile, database); each rolls back on its own, and
each has its own verification below. Nothing here is automatic: every
step is a dashboard / console action by Rishabh or the parent agent.

## 0. Decide what "bad" means — roll back if any of these is true

- `/health` on the backend returns non-200, or SOS/alert routes 5xx.
- Sign-up / login / OTP code requests fail for a real phone.
- The app crashes on launch or SOS does not reach guardians.
- A secret was pasted in chat, committed, or otherwise exposed
  (rotate first — see `SECRET_ROTATION.md` — then roll back if the
  exposure came with a bad deploy).

## 1. Backend — Vercel redeploy of the previous deployment

Project: **safelife-backend** — live at
`https://safelife-backend-rish0000-dots-projects.vercel.app`.
Landing (separate project **landing**,
`https://landing-rosy-delta-55.vercel.app`) and web app
(`https://safelife-ai.vercel.app`) roll back the same way if they are
the bad surface.

1. Vercel dashboard → project → **Deployments**.
2. Find the last **Ready / Current** deployment from before the bad
   release (note its commit SHA and time).
3. Open it → **⋯ → Redeploy**. Do NOT tick "use existing Build Cache"
   if the bad build may have poisoned the cache; a clean rebuild is
   slower but trustworthy.
4. Wait for status **Ready**. Note the new deployment id.
5. Verify (see §5) before telling anyone it is fixed.

Notes:

- Redeploying an old deployment does **not** change environment
  variables. If the bad release also changed an env var, fix the var
  first (Vercel → Settings → Environment Variables → Production),
  then redeploy.
- Never roll back by pushing a revert commit to `main` in a hurry:
  `main` auto-deploys, so a revert push is a second deploy, not a
  rollback — and it is harder to tell which deployment is live.
  Use the dashboard redeploy above; a revert commit can follow
  calmly afterwards.

## 2. Mobile — rebuild from the previous tag via EAS

There is no "un-ship" for an APK already on a phone. Rollback here
means: build the previous known-good code and distribute that APK.

- App: SafeLife, package `com.rishabh.safelifeai`, EAS project
  `f0290930-811f-49c4-960c-fad1abd68b75`, owner
  `rishabhsharma14426s-team`.
- APKs are built by `.github/workflows/build-apk.yml`
  (workflow_dispatch, branch `apk-build`, `preview` profile →
  APK, released as `apk-<run_number>`).

1. Find the last good commit/tag on the `apk-build` branch (the run
   that produced the last good APK — GitHub → Actions → build-apk.yml
   → the run number and its commit SHA).
2. If the last good APK release still exists (GitHub → Releases →
   `apk-<run_number>`), re-distribute that exact APK file to testers
   first — no rebuild needed.
3. Otherwise: check out that commit on the `apk-build` branch (or
   push a revert), then **Actions → build-apk.yml → Run workflow**
   and wait for the run to complete. Download the APK from the new
   release.
4. Install on a test phone, run §5 checks, then distribute.

Notes:

- A rebuild bakes in the **current** `eas.json` env (Supabase URL,
  anon key, backend URL). If any of those changed since the good
  build, the rebuilt APK is not identical to the old one — check
  `eas.json` first.
- Old APKs hold the old `EXPO_PUBLIC_API_SECRET` (pre-Day-30 builds).
  Rolling the app back does **not** roll the secret back — see §4.
- The `production` EAS profile builds an app bundle (AAB), not an
  APK; test rollbacks always use the `preview` APK profile.

## 3. Database — migration rollback notes

Supabase has **no automatic migration rollback**. A migration that
ran is not undone by deleting its file.

- **If the bad migration has NOT been applied yet:** do nothing.
  Delete or rename the file so it is not applied later, and note it
  in the run log.
- **If the bad migration HAS been applied:** write a *new*,
  forward-only migration that undoes exactly what the bad one did
  (e.g. `DROP POLICY`, `DROP COLUMN`, restore a previous default).
  Never edit the applied migration file in place — Supabase tracks
  applied migrations, and an edited file will not re-run.
- **Destructive undo is forbidden on live without a backup:**
  dropping a table or column deletes data. Take a backup first
  (see `BACKUP_RESTORE.md`) and confirm the restore procedure
  works on a throwaway project before dropping anything live.
- **`20261116013000_profiles_emergency_contacts.sql`** (run-6):
  on a fresh project it can be undone with the `DROP TABLE`
  statements in its own footer. On the live project it must NOT
  be dropped — it would delete every profile and emergency
  contact. The live undo is policies-only: re-run
  `20261022120000_rls_owner_only.sql` +
  `20261108090001_rls_revoke_grant.sql`.
- **Data fix, not schema fix:** if bad code wrote bad rows (not bad
  schema), fix the rows with a targeted `UPDATE` in the SQL Editor
  after a backup — never by restoring the whole database, which
  would also wipe good rows written since.

## 4. API_SECRET rotation reversal

`API_SECRET` is the shared secret for HMAC capability tokens and the
time-boxed compat fallback for old APKs. Rotation is one-way in
practice:

- Rotating (new value in Vercel Production + redeploy) instantly
  invalidates every already-distributed APK's fallback auth until
  the Day-30 re-ship. There is no "rotate back" that is safe to do
  blindly: putting the old value back re-enables any copy of the
  old secret that leaked.
- If a rollback needs the old value (e.g. the new secret was typed
  wrong and logins break), restore it **only** if the old value was
  never exposed, then rotate properly immediately after the incident
  is over. Record the decision and the time in the run log.
- `PROOF_SECRET` falls back to `API_SECRET` when unset, so rotating
  `API_SECRET` also rotates proof signing unless `PROOF_SECRET` is
  set independently. Set both explicitly; rotate both together.
- Full per-secret procedure: `SECRET_ROTATION.md`.

## 5. Verification after rollback (do all of these, in order)

Backend (from any machine):

```bash
curl -s https://safelife-backend-rish0000-dots-projects.vercel.app/health
# expect: 200, and the deployment id / commit in Vercel matches the
# redeployed (previous) deployment, not the bad one.
```

Supabase (SQL Editor, project `safelife`):

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
and tablename in ('profiles','emergency_contacts','sos_alerts',
  'guardians','journeys','signup_codes','login_codes',
  'gnani_daily_usage');
-- expect: every row rowsecurity = t
select count(*) from public.profiles;
select count(*) from public.emergency_contacts;
-- expect: counts match the pre-incident counts recorded in the run
-- log (a rollback must not change row counts)
```

Mobile (test phone, never a real SOS):

1. Fresh sign-up works (OTP code arrives, verifies).
2. Login with an existing account works.
3. Profile loads; emergency contacts list loads and saves.
4. Test-alert route (if enabled) or a drill alert reaches the
   guardian channel. Do not fire a real SOS to real guardians
   for a rollback check.

Landing / web app (if they were the rolled-back surface):

- Landing `https://landing-rosy-delta-55.vercel.app` loads, privacy
  page (`/privacy.html`) renders.
- Web app `https://safelife-ai.vercel.app` loads and login works.

Only when all of the above pass is the rollback done. Log: what
was rolled back, to which deployment/commit, when, and the
verification results. Then fix the bad release calmly on a branch —
never by re-pushing the same broken commit.
