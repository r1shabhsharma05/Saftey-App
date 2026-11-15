# SafeLife uptime monitoring + error alerts (H14)

Setup guide only. Creating the monitor needs Rishabh's own account
on the monitoring service — Muse cannot create it for him. Pick
one provider, follow §1, then verify with §3.

## 1. Provider — pick one (free tier)

| Provider | Free tier (verify at signup — tiers change) | Why pick it |
|---|---|---|
| **UptimeRobot** | Free plan: monitors with 5-minute checks, email alerts | Simplest; the default choice if there is no reason to pick otherwise |
| **Better Stack** | Free plan: monitors with 3-minute checks, email + Slack + webhook alerts, status page | Better alerting + a public status page; pick this if alerts should also go to Telegram/Slack |

Either is fine. Do not run both — two alert streams for one outage
is noise, and noise gets muted.

## 2. Monitors to create

| # | Name | URL | Check | Alert if |
|---|---|---|---|---|
| 1 | SafeLife backend health | `https://safelife-backend-rish0000-dots-projects.vercel.app/health` | HTTP(s), keyword `ok` / status 200 | Status ≠ 200, or keyword missing, for 2 consecutive checks |
| 2 | SafeLife landing | `https://landing-rosy-delta-55.vercel.app` | HTTP(s), status 200 | Status ≠ 200 for 2 consecutive checks |
| 3 | SafeLife web app | `https://safelife-ai.vercel.app` | HTTP(s), status 200 | Status ≠ 200 for 2 consecutive checks |
| 4 | Supabase project (optional) | Supabase Status page / project health | Use Supabase's own status notifications, not a ping | Supabase posts an incident in ap-south-1 |

Notes:

- Monitor **`/health`**, not `/`: `/health` exercises the backend
  process; `/` may answer from the CDN while the backend is down.
- 5-minute checks (UptimeRobot free) mean up to 5 minutes of
  blindness. That is acceptable for this app; 1-minute checks are
  a paid feature and are not required.
- Do NOT monitor an authenticated route (e.g. `/admin/audit`) —
  it 401s/403s by design and would alert forever.
- Do NOT set the monitor to hit an SOS or alert route — a monitor
  firing SOS is a false alarm to real guardians.

## 3. Alert channel — where the alert goes

Set at least one channel that Rishabh actually reads within the
hour. In order of preference:

1. **Email** to Rishabh's primary inbox (the default on both
   providers; confirm the address at signup — alerts to an inbox
   nobody reads are the same as no alerts).
2. **Telegram** (Better Stack webhook → a bot, or UptimeRobot's
   Telegram integration): the guardian-alert channel already runs
   on Telegram, so an outage alert there is seen fastest. Do not
   send uptime alerts into the guardian SOS chat — use a separate
   chat / DM.
3. **Slack** (Better Stack only): only if the team already lives
   there.

Test the channel on day one: pause the backend's monitor, or use
the provider's "test alert" button, and confirm the message
arrives. An untested alert channel is assumed broken.

## 4. Error alerts (beyond up/down)

Uptime checks catch "the site is down". They do not catch "the
site is up but SOS is broken". Add these:

- **Vercel logs watch (manual, weekly):** Vercel → project
  `safelife-backend` → Logs → search for
  `Upstash checkRateLimit failed: 401` (the run-5 6.1 failure
  mode — any recurrence means the limiter token is wrong again),
  `ValidationError`, and `5xx` spikes on `/alert` and
  `/auth/*/request-code`.
- **Supabase logs watch (manual, weekly):** Supabase →
  Logs → Auth / Database — failed logins spike, RLS denials
  spike, or Postgres errors.
- **Gnani usage watch (manual, weekly):** Gnani console → usage.
  A sudden jump in calls (or the daily counter hitting 50 early)
  means abuse or a bug looping voice calls — see
  `SPENDING_CAPS.md`.
- **httpSMS balance watch:** the gateway phone's httpSMS balance
  / credit — an empty balance means SOS SMS silently stops. See
  `SPENDING_CAPS.md`.

When any of these becomes a repeat manual chore, that is the
trigger to add a proper error-tracking service (e.g. Sentry free
tier) — but that is a new SDK in the backend, i.e. a code change,
not a dashboard step, and it needs Rishabh's word first. Until
then, the weekly manual watch above is the error-alert system.

## 5. Runbook — when an alert fires

1. Open the monitor link: is it really down, or one failed check?
2. Vercel → Deployments: is the Current deployment Ready? If a
   deploy is in progress, wait for it — do not roll back a deploy
   that has not finished.
3. `curl -s https://safelife-backend-rish0000-dots-projects.vercel.app/health`
   from a second network (phone data, not the same Wi-Fi) to rule
   out a local network issue.
4. If down: check Supabase status (is ap-south-1 having an
   incident?) and Vercel status before touching code.
5. If the backend is the fault and the last deploy caused it:
   roll back per `ROLLBACK.md` §1.
6. Log the incident: time, duration, cause, fix. If guardians
   could not be reached during the outage, say so honestly in the
   incident note — for a safety app, a silent outage is worse
   than an admitted one.
