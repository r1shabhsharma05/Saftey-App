# H5 — Two-account live authorisation test

Live-test script for the backend authorisation boundary: every
handler must refuse a caller touching another user's resource.
Written from the run-6 handler inventory — **50 handlers, not
48** (the earlier count missed two; the matrix below is the
verified set).

## 0. ⚠️ Read this first — there is no staging backend

Preview APKs point at the **same production backend** as the
release APK. This test writes to **live tables**: the A/B test
users, their alerts, journeys, guardians and contacts are real
rows in production. **Delete the A/B test users and all their
rows afterwards** (DELETE /auth/account per account, then verify
in Supabase that no test rows remain), per H11. Use test
emails/phones that belong to no real user, and run the test when
no real SOS drill is in progress.

## 1. Handler matrix (50 handlers)

Base URL: the production backend (`safelife-backend-*.vercel.app`).

### 1a. JWT-only — 29 handlers

A call with another user's JWT, or no JWT, must fail (401 without
a token, 403 on another user's resource). The owner calling their
own resource must succeed.

| # | Method + route |
|---|---|
| 1 | GET /admin/audit |
| 2 | POST /alert |
| 3 | POST /battery-alert |
| 4 | POST /alert/:id/close |
| 5 | POST /alert/:id/guardian/:guardianId/accept |
| 6 | POST /alert/:id/guardian/:guardianId/decline |
| 7 | POST /alert/:id/guardian/:guardianId/location |
| 8 | POST /alert/:id/message |
| 9 | POST /location-update |
| 10 | POST /test-alert |
| 11 | GET /alert/:id |
| 12 | POST /auth/profile/dob |
| 13 | DELETE /auth/account |
| 14 | POST /guardians |
| 15 | POST /guardians/:id/request-code |
| 16 | POST /guardians/:id/verify |
| 17 | POST /guardians/:id/availability |
| 18 | POST /guardians/:id/location |
| 19 | GET /guardians/nearby |
| 20 | GET /guardians/:id/alerts |
| 21 | GET /guardian/:id |
| 22 | POST /journeys |
| 23 | POST /journey/:id/location |
| 24 | POST /journey/:id/arrived |
| 25 | POST /journey/:id/cancel |
| 26 | POST /journey/:id/checkin |
| 27 | GET /journey/:id |
| 28 | POST /voice/synthesize |
| 29 | POST /voice/transcribe |

### 1b. HMAC-or-JWT — 1 handler

| # | Method + route |
|---|---|
| 30 | POST /alert/:id/ack |

### 1c. HMAC-inside-handler — 7 handlers

These check the HMAC view token inside the handler (not in the
JWT middleware). A wrong or missing token must fail with 401.

| # | Method + route |
|---|---|
| 31 | POST /escalate |
| 32 | POST /delivery-retry |
| 33 | POST /journey-escalate |
| 34 | GET /alert/:id/view |
| 35 | GET /alert/:id/location |
| 36 | GET /journey/:id/view |
| 37 | GET /journey/:id/location |

### 1d. Truly public — 13 handlers

No auth by design. Do NOT "fix" these into requiring a JWT —
verify instead that they leak nothing (see step 4).

| # | Method + route |
|---|---|
| 38 | POST /auth/signup/request-code |
| 39 | POST /auth/signup/verify-code |
| 40 | POST /auth/signup/complete |
| 41 | POST /auth/login/precheck |
| 42 | POST /auth/login/request-code |
| 43 | POST /auth/login/verify-code |
| 44 | POST /auth/forgot-password |
| 45 | GET /police/nearest |
| 46 | GET /route |
| 47 | GET /safe-places |
| 48 | GET / |
| 49 | GET /health |
| 50 | GET /version |

## 2. Setup

1. Create account **A** (test email + test phone, DOB 13+).
   Sign in, keep A's JWT.
2. Create account **B** (different test email + test phone).
   Sign in, keep B's JWT.
3. Each account creates, from its own session:
   - one SOS alert (note its id),
   - one journey (note its id),
   - one guardian (note its id; verify it by SMS code so the
     guardian is usable),
   - one emergency contact.
4. Record A's and B's resource ids in a scratch table before
   starting — every step below needs an A-id and a B-id.

## 3. Cross-account matrix (the core test)

For **every** JWT-only handler (§1a) and **every**
HMAC-inside-handler route (§1c) that takes a resource id:

1. **Cross call:** call as A against B's resource id, then as B
   against A's resource id.
   - JWT-only: expect **403** (authenticated, not the owner).
   - HMAC: expect **401** with a wrong/missing view token.
   - Also try each with **no token at all**: expect **401**.
2. **Owner control:** the same call as the owner, on the owner's
   own resource id. Expect **success** (2xx, or the handler's
   normal success shape). A control that fails means the test
   setup is wrong, not that the cross call passed — fix the
   setup and re-run before recording a result.
3. Record per handler: cross-A→B, cross-B→A, no-token,
   owner-control. Any cross call that succeeds is a **FAIL —
   stop and report it**; do not continue past a confirmed
   cross-account read/write.

Routes without a resource id in §1a (POST /alert,
/battery-alert, /location-update, /test-alert, /guardians,
/journeys, /auth/profile/dob, GET /admin/audit,
/guardians/nearby, GET /health-adjacent reads): test with A's
JWT vs B's JWT where the handler takes an owner-scoped body
(e.g. a journey/alert id in the body), and with no token (401).
POST /alert and POST /journeys create rows owned by the caller —
verify the created row's owner is the caller, not the id named
in the body (if the body can name an owner at all, that is a
FAIL).

## 4. POST /alert/:id/ack — the dual-auth handler (§1b)

1. As A with **A's JWT** on **B's alert** → must **fail**
   (not A's alert; the JWT path must enforce ownership).
2. Same call with **B's view token** (the HMAC token issued for
   B's alert) → must **succeed**.
3. Same call with a **wrong/missing view token and no JWT** →
   **401**.
4. As B (owner) with B's JWT on B's alert → must **succeed**
   (control).

## 5. Forgot-password — public, must not leak (§1d #44)

1. POST /auth/forgot-password **without** a Turnstile token →
   **400 'Human verification failed'** (already live-proven;
   re-confirm it still holds).
2. With a **valid token solved in the widget** → generic success
   response, and **no SMS content leaked** in the response
   (no code, no email, no "account exists" signal — the same
   answer whether or not the number has an account). A valid
   token only comes from solving the real widget; do not fake
   one.

## 6. Guardian request-code rate limit (§1a #15)

1. POST /guardians/:id/request-code **6 times in rapid
   succession** on **A's own guardian**, with A's JWT.
2. The **6th must be 429** (`phoneCodeLimiter`, 5/min). The
   first 5 may succeed (each sends an SMS code — expect up to
   5 real SMS to the test phone).
3. If the 6th is not 429, the limiter is not live — FAIL.

## 7. DELETE /auth/account — re-auth gate (§1a #13)

**Destructive — test accounts only. Never run against a real
user.**

1. With a JWT **older than 15 minutes** (sign in, wait 15 min,
   then call) → **401 REAUTH_REQUIRED**.
2. With a **fresh login** (sign in, call immediately) → the
   wipe proceeds (profile, contacts, guardians, journeys, SOS
   alerts, avatar).
3. After step 2, verify in Supabase that A's rows are gone.
   (This is also the cleanup for account A; repeat the fresh-
   login delete for B at the end of the run.)

## 8. Cleanup (mandatory — see §0)

1. DELETE /auth/account (fresh login) for A and for B.
2. Verify in Supabase: no rows remain for either test user in
   `profiles`, `emergency_contacts`, `guardians`,
   `sos_alerts`, `journeys`, `signup_codes`, `login_codes`.
3. Verify no test SMS/Telegram messages went to any real
   contact (guardians/contacts used test numbers only).

## 9. Pass bar

**PASS** only when: every §3 cross call fails with the expected
status, every owner control succeeds, §4 ack behaves as
specified, §5 returns 400 without a token and leaks nothing
with one, §6 429s on the 6th call, §7 gates on stale JWT and
wipes on fresh login, and §8 cleanup is verified. One
unexpected success anywhere is a FAIL for the whole run.
