# SafeLife spending caps checklist (H2)

One page: every paid surface, where its cap lives, and what happens
when it is hit. Console values are Rishabh's step — Muse cannot set
them. Verify every limit in the provider's own dashboard; free-tier
numbers change, and this file must not be trusted over the console.

Rule of thumb: a safety app must **fail safe, not fail silent**.
A cap that silently stops SOS SMS is worse than a cap that loudly
stops a voice feature. Where a provider lets you choose, prefer
hard-stop-with-alert over silent degradation for SOS paths, and
hard-stop for everything else.

## 1. Gnani Vachana — the only per-call cost that can spike

- **What it costs:** Vachana Speech APIs (Prisma STT + Timbre TTS)
  are billed per call / per character or per minute against the
  Gnani console balance. SafeLife's challenge credits were
  5,000 total, ~4,900 remaining on 2026-11-14 (i.e. the account is
  nearly full — verify the live balance, do not trust this number).
- **Code-side guard (already in):** `gnani_daily_usage` table, 50
  voice calls/day shared across all instances (migration
  `20261115220000_gnani_daily_usage.sql`, **not yet applied** —
  until it is applied the cap is per-instance in-memory and a
  flood spread across Vercel cold starts gets 50/day *per
  instance*). Voice routes are JWT-only; IP callers are a fallback.
- **Console steps (Rishabh):**
  1. Gnani console (app.gnani.ai) → Billing / Usage → note the
     current balance and the per-call price.
  2. Set a **hard spending cap / usage limit** if the console
     offers one; if it offers only alerts, set the alert at 80%
     of balance.
  3. **Auto-recharge OFF.** If the console has an auto-top-up or
     auto-recharge toggle, confirm it is off — an auto-recharge
     turns a bug into an open-ended bill.
  4. Set the billing alert email to an inbox that is actually read.
- **If the cap is hit:** voice features honestly report
  not-configured / limit-reached. SOS itself does not depend on
  Gnani (Telegram + SMS carry SOS) — confirm that stays true
  after any voice change.

## 2. Supabase (project `safelife`)

- **Console:** dashboard → Settings → Billing / Usage.
- **Checklist:** note the plan (Free / Pro); note the current
  usage vs the plan's limits for database size, storage (`avatars`
  bucket), monthly active users, and bandwidth. Free-tier limits
  are small — the `avatars` bucket (5 MB per photo) and the
  `sos_alerts` / `audit_events` tables are the growth surfaces.
- **Cap:** Supabase does not hard-stop on overage by default on
  most plans — it bills or throttles. If the project is on Pro,
  confirm the spend cap setting in Billing. If on Free, confirm
  what happens at the limit (throttle vs block) and set a usage
  alert.
- **Pause risk:** a Free project that goes idle can be paused by
  Supabase. SafeLife + SecureGaurd Supabase projects must stay
  unpaused — check Usage regularly.

## 3. Upstash (Redis + QStash)

- **Console:** upstash.com → database `safelife-ratelimit` →
  Usage; QStash → Usage.
- **Checklist:** note the plan and the daily / monthly request
  allowance. The rate limiters hit Redis on **every** guarded
  request (SOS, code requests, tracking) — a traffic spike is a
  Redis spike. QStash carries delivery retries + the escalation
  ladder (delayed jobs) — a stuck retry loop is a QStash spike.
- **Cap:** if the plan offers a hard limit / spend cap, set it;
  otherwise set the usage alert at 80%. A Redis outage fails open
  to in-memory limiters (logged) — safe, but the logs must be
  watched (`UPTIME_MONITORING.md` §4).

## 4. Vercel (backend `safelife-backend`, landing `landing`, web app)

- **Console:** vercel.com → each project → Settings → Usage /
  Billing.
- **Checklist:** note the plan (Hobby / Pro) and usage vs limits
  for bandwidth, serverless function execution time, and build
  minutes. The backend is a serverless API — a flood of SOS or
  code-request calls is a function-invocation spike.
- **Cap:** Hobby has no spend cap to set (it hard-stops at the
  limit — which for a safety app means the backend goes down, so
  know the limit). On Pro, set the spend cap in Billing.
- **Mitigation already in code:** per-IP rate limiters on SOS,
  code, and tracking routes (run-5 6.1 fixed) bound the worst
  case per caller.

## 5. Render (SecureGaurd classifier — not SafeLife, listed so it is not forgotten)

- The classifier at `secureguard-classifier.onrender.com` runs on
  Render Free. Free instances spin down after inactivity and have
  a monthly hours allowance. If it ever becomes part of the
  SafeLife path, its cap belongs here. Today it is not — noted
  only so nobody assumes it is covered.

## 6. httpSMS — SMS balance (SOS path — check this one most often)

- **What it costs:** SMS credits on the httpSMS account, spent per
  verification code and per SOS SMS. The gateway is an Android
  phone running the httpSMS app — it must also stay online,
  charged, and with mobile data / SMS credit on its own SIM.
- **Console steps (Rishabh):**
  1. httpsms.com dashboard → check the balance / remaining credits.
  2. Set the low-balance alert (email) at a level that leaves at
     least a week of SOS SMS in hand.
  3. Confirm **no auto-recharge** is on unless Rishabh explicitly
     wants it (same rule as Gnani — a bug must not become a bill).
- **If the balance hits zero:** SMS verification and SOS SMS stop
  silently from the user's point of view (the code honestly
  reports the failure server-side, but the user just sees "code
  not arriving"). Telegram still carries SOS to guardians who use
  it. Treat a zero balance as an incident, not a billing detail.

## 7. Telegram, Cloudflare Turnstile, Mapbox, Firebase FCM

- **Telegram Bot API:** free, no spend cap. No action — except
  that a revoked bot token (see `SECRET_ROTATION.md` §5) stops
  SOS Telegram delivery until the new token is deployed.
- **Cloudflare Turnstile:** free tier for the current volume; if
  the widget ever moves to a paid tier, the cap belongs here.
- **Mapbox:** free-tier tile / API allowance. The token is a
  public token (`EXPO_PUBLIC_MAPBOX_TOKEN`) — if it is abused,
  rotate it in the Mapbox dashboard (see `SECRET_ROTATION.md` §6)
  and set a usage alert / URL restriction there.
- **Firebase FCM:** free for the current volume. No cap action
  until push tokens are actually collected (not yet — see
  `PRIVACY_LABELS.md` §2).

## 8. Monthly check (5 minutes, Rishabh)

On the 1st of each month, open each console above and record:
balance / usage vs limit, any alert fired, auto-recharge still off.
One line per provider in the run log. If any provider has no alert
set, set it then — an unmonitored cap is not a cap.
