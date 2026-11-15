# SafeLife secret rotation procedure (H1)

Rotate a secret when it has been pasted in chat, committed to git,
shown on screen, emailed, or otherwise exposed — or on a schedule
after any incident. Never paste a secret value into chat, a doc, a
URL, or a GitHub issue. New values are generated on the machine that
owns them and entered directly in the provider dashboard / secure
entry card.

Golden rules (apply to every secret below):

1. Generate the new value first, from a trusted generator
   (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   for 64-hex secrets). Never reuse, never type from memory.
2. Put the new value in the provider dashboard, then redeploy /
   rebuild so the running code picks it up. A rotated value that
   was never deployed is not rotated.
3. Revoke / delete the old value at the provider immediately after
   the new one is verified live. Two live values is a leak window.
4. Verify after rotation (§8) before calling it done.
5. If a secret was committed to git history, rotating is not enough
   — history still holds it. Purge or rotate + accept the history
   exposure (decide per secret, log the decision).

## 1. Inventory — every secret, where it lives

| Secret | Lives in | Public? | Rotation trigger |
|---|---|---|---|
| `API_SECRET` | Vercel Production env (project `safelife-backend`); old APKs (pre-Day-30 builds, baked in at build time) | No — server-side | Any exposure; Day-30 activation (planned) |
| `PROOF_SECRET` | Vercel Production env (`safelife-backend`) | No — server-side | Any exposure; with `API_SECRET` |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel Production env (`safelife-backend`) | **No — bypasses RLS, full DB access** | Any exposure — treat as critical |
| `SUPABASE_URL` | Vercel env + `eas.json` + `.env.example` | No (but not a secret by itself — it is the project URL; the key is the secret) | Only if the project itself is recreated |
| `SUPABASE_ANON_KEY` | Vercel env + `eas.json` (preview + production env) + GitHub secret `EXPO_PUBLIC_SUPABASE_ANON_KEY` + app binary | **Public by design** — ships in every APK | Only if Supabase revokes it; a "leak" of the anon key alone is not an incident (RLS is the real control) |
| `GNANI_API_KEY` | Vercel Production env (`safelife-backend`) | No — server-side | Any exposure; Gnani console → regenerate |
| `HTTPSMS_API_KEY` | Vercel Production env | No — server-side | Any exposure; httpsms.com dashboard → regenerate |
| `TELEGRAM_BOT_TOKEN` | Vercel Production env | No — server-side | Any exposure; rotate via `@BotFather` → `/revoke` |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel Production env | No — server-side | Any exposure; Upstash console → regenerate (use the 63-char **default** token, Read-Only toggle OFF — the read-only token rejects writes and caused the run-5 6.1 incident) |
| `QSTASH_TOKEN` | Vercel Production env | No — server-side | Any exposure; Upstash console → QStash → regenerate |
| `TURNSTILE_SECRET_KEY` | Vercel Production env | No — server-side | Any exposure; Cloudflare dashboard → Turnstile → rotate |
| `TURNSTILE_SITE_KEY` (`EXPO_PUBLIC_TURNSTILE_SITE_KEY`) | App / `eas.json` | **Public by design** (site key) | Never — it is not a secret |
| `FCM_PRIVATE_KEY` + `FCM_CLIENT_EMAIL` + `FCM_PROJECT_ID` | Vercel Production env | No — server-side (service-account key) | Any exposure; Firebase console → Service accounts → delete key, generate new, split into the three vars |
| `WHATSAPP_ACCESS_TOKEN` | Vercel Production env | No — server-side | Any exposure; Meta Business Settings → System User → generate new permanent token |
| `EXPO_PUBLIC_MAPBOX_TOKEN` | GitHub secret `EXPO_PUBLIC_MAPBOX_TOKEN` + app binary | **Public token by design** (client-side map token; scope it in Mapbox to URL restrictions) | Only if abused — rotate in Mapbox dashboard + update GitHub secret + rebuild |
| `EXPO_PUBLIC_API_SECRET` | Old APK builds only (no longer injected — `.github/workflows/build-apk.yml` does not pass it) | Was client-side; **must never be re-added** | N/A — if it ever reappears in a build, remove it and rotate `API_SECRET` |
| GitHub `GITHUB_TOKEN` | Workflow runs (auto-issued per run) | No | Auto-expires per run; nothing to rotate |
| EAS / Expo access token | Whoever runs `eas build` locally / CI | No | Expo dashboard → Access Tokens → revoke + create new |
| Supabase Postgres password / dashboard password | Supabase dashboard login (Rishabh) | No | Supabase dashboard → Settings → Database → reset password; **never** share it in chat |

Not secrets (do not rotate): `HTTPSMS_FROM` (gateway phone number),
`TELEGRAM_CHAT_IDS`, `ADMIN_USER_IDS` (allowlist), `PUBLIC_BASE_URL`,
`CORS_ALLOWED_ORIGINS`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_TEMPLATE_NAME` / `_LANGUAGE`, `ENABLE_TEST_ALERT`.

## 2. Vercel secrets (most secrets) — generic procedure

Applies to: `API_SECRET`, `PROOF_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`, `GNANI_API_KEY`, `HTTPSMS_API_KEY`,
`TELEGRAM_BOT_TOKEN`, `UPSTASH_REDIS_REST_TOKEN`, `QSTASH_TOKEN`,
`TURNSTILE_SECRET_KEY`, `FCM_*`, `WHATSAPP_ACCESS_TOKEN`.

1. Generate / obtain the new value at its provider (see §1, right
   column — each provider has its own regenerate step).
2. Vercel dashboard → project `safelife-backend` → Settings →
   Environment Variables → edit the variable (Production) → paste
   the new value → Save.
3. Deployments → latest → **⋯ → Redeploy** (clean rebuild if in
   doubt). Wait for **Ready**.
4. Verify (§8). Only then revoke/delete the old value at its
   provider. If the provider auto-revokes on regenerate (most do),
   step 4's verification doubles as the proof the old value is dead.

## 3. `API_SECRET` — special handling

- Rotating `API_SECRET` instantly invalidates the time-boxed compat
  fallback (`x-api-key`) in every already-distributed APK. That is
  intended at Day-30 activation; outside Day 30 it is a user-visible
  break for old APKs, so rotate only on exposure or at Day 30.
- `PROOF_SECRET` falls back to `API_SECRET` when unset. Rotate both
  together, or set `PROOF_SECRET` explicitly first and rotate them
  independently.
- Old APKs cannot be updated in place — the fix is the Day-30
  re-ship (new APK via the `apk-build` workflow). See `ROLLBACK.md` §4.

## 4. `SUPABASE_SERVICE_ROLE_KEY` — critical

This key bypasses RLS entirely. If it was ever pasted in chat or
committed, treat it as compromised until rotated:

1. Supabase dashboard → project `safelife` → Settings → API →
   **Generate new service_role key** (or "Rotate" if shown).
2. Vercel → `safelife-backend` → update
   `SUPABASE_SERVICE_ROLE_KEY` → redeploy → verify (§8).
3. Confirm the old key is dead: any request with the old key must
   401. (Test with a throwaway `curl` from a local machine — never
   paste the old key anywhere shared.)
4. Check Supabase → Auth → Logs / Database → Logs for unexpected
   access during the exposure window.

## 5. `TELEGRAM_BOT_TOKEN` — via @BotFather

1. Telegram → `@BotFather` → `/mybots` → SafeLife bot → **API Token
   → Revoke current token** → copy the new token.
2. Vercel → update `TELEGRAM_BOT_TOKEN` → redeploy → verify (§8:
   send a test alert to the guardian channel; it must arrive).

## 6. GitHub secrets (APK workflow)

Applies to: `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_MAPBOX_TOKEN`.

1. GitHub → repo `r1shabhsharma05/Saftey-App` → Settings → Secrets
   and variables → Actions → update the secret.
2. The new value only reaches the **next** APK build — trigger a
   fresh `build-apk.yml` run and confirm the new APK works (§8).
3. Note: `eas.json` also carries the anon key for local EAS builds.
   Update `eas.json` in the same change, or local builds will keep
   shipping the old key.

## 7. If a secret was committed to git

1. Rotate the secret immediately (§2–§6). Rotation stops future
   abuse; it does not erase history.
2. Decide: purge history (`git filter-repo` + force-push, then
   every clone re-clones) or accept the exposure and log it.
   History purge on a shared repo is disruptive — it is Rishabh's
   call, not Muse's. Precedent: a real JWT secret was rotated on
   2026-11-08 after being found in pushed history; the history
   purge is still pending his word. Farmer `.env` keys in history
   still need rotation.
3. Never "fix" a committed secret by committing a new file that
   overwrites it — the old commit still holds the value.

## 8. Verification after rotation

Run after every rotation, per secret:

- Backend: `curl -s https://safelife-backend-rish0000-dots-projects.vercel.app/health`
  → 200 (proves the redeploy with the new env is live).
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_URL`: login works,
  profile loads, SOS alert persists (test alert, not a real SOS).
- `API_SECRET` / `PROOF_SECRET`: signup code request + verify
  works end-to-end on a test phone.
- `GNANI_API_KEY`: `POST /voice/synthesize` returns audio (test
  call, JWT-only route).
- `HTTPSMS_API_KEY`: an SMS code request delivers (or honestly
  reports not-configured if the gateway phone is off — that is a
  gateway problem, not a key problem).
- `TELEGRAM_BOT_TOKEN`: a test alert arrives in the guardian chat.
- `UPSTASH_*` / `QSTASH_*`: rate-limit counters move — check
  Vercel logs for `Upstash checkRateLimit failed: 401`; zero
  matches after rotation means the new token works (a 401 here
  was the run-5 6.1 failure mode).
- `TURNSTILE_SECRET_KEY`: code request with a valid Turnstile
  token succeeds; without one it is rejected (no longer fail-open).
- `FCM_*`: push adapter reports configured (FCM send itself
  needs a collected token — not yet implemented in the app).
- `WHATSAPP_ACCESS_TOKEN`: adapter reports configured; a test
  send returns 2xx from Meta (accepted, not delivered).

Log every rotation: secret name, date, reason, who did it, and the
verification result. Never log the value — old or new.
