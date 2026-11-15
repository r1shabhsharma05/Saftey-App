# SafeLife user security checklist (H4 / H11 / H12)

Short checklists Rishabh must do himself. Muse cannot do these —
they are his accounts, his devices, his domains. Tick each item,
date it, and keep this file as the record.

## H4 — Two-factor authentication everywhere

Turn on 2FA (authenticator app, not SMS where a choice exists — SIM
swap defeats SMS 2FA) on every account that can touch SafeLife.
Check each one off only after confirming it asks for a code on a
fresh login.

- [ ] **GitHub** (`r1shabhsharma05`) — Settings → Password and
  authentication → Two-factor authentication. Also: review
  Settings → Applications → Authorized OAuth Apps, and revoke
  anything unrecognised. The repo holds the code; a stolen GitHub
  session is a stolen codebase.
- [ ] **Google** (`rishabhsharma14426@gmail.com` and any other
  Google account used for SafeLife) — myaccount.google.com →
  Security → 2-Step Verification. This account owns the Firebase
  project, the Play Console login path, and the outreach mailbox.
- [ ] **Supabase** (project `safelife`) — dashboard login 2FA.
  Supabase holds the database and the service_role key.
- [ ] **Vercel** (projects `safelife-backend`, `landing`, web app)
  — Settings → Security → 2FA. Vercel holds every production
  secret as env vars.
- [ ] **Cloudflare** (Turnstile) — dashboard 2FA. Holds the
  Turnstile secret key.
- [ ] **Upstash** (Redis + QStash) — account 2FA. Holds the
  rate-limiter token.
- [ ] **Gnani** (app.gnani.ai console) — account 2FA if offered.
  Holds the Vachana API key and the billing balance.
- [ ] **Meta Business** (WhatsApp Business API, if the WhatsApp
  channel is ever activated) — Business Settings → 2FA. Holds the
  permanent WhatsApp access token.
- [ ] **Expo / EAS** (account `rishabhsharma14426s-team`) — 2FA.
  Holds the EAS project and build signing.
- [ ] **Telegram** (`@safe_alret_bot` owner account) — Settings →
  Two-Step Verification. The bot token's owner account is a
  takeover target: a stolen Telegram account can revoke or abuse
  the SOS bot.
- [ ] **Firebase** (SafeLife project, FCM) — covered by the Google
  2FA above; confirm the Firebase project is under that same
  Google account and not a stray one.
- [ ] **httpSMS** (httpsms.com dashboard) — 2FA if offered; if
  not offered, use a unique password (see below).

Password rules for all of the above:

- Unique password per service (a password manager, not memory).
  Never reuse the password of any account across two services.
- Recovery codes: print / store them offline (not in the repo, not
  in chat, not in a screenshot in the photo library). Losing both
  the phone and the recovery codes locks the account.
- After enabling 2FA anywhere, sign out everywhere and sign back
  in once to prove the second factor actually gates login.

## H11 — Test accounts stay in Preview, never live

Test accounts and test data must never be able to trigger a real
SOS, a real SMS, or a real guardian alert.

- [ ] **Test accounts use obviously-test identities.** Test
  profiles use a test phone / test email (never a real guardian's
  number, never Rishabh's own number unless the test is explicitly
  a live drill). If a test account exists on live, its phone must
  not be any real person's.
- [ ] **Test builds point at Preview, not Production.** The EAS
  `preview` profile builds the test APK; its backend URL is the
  same production backend today (see `eas.json`) — so a test APK
  talks to the live backend. Until a separate staging backend
  exists, treat every test-APK action as a live-backend action:
  no test SOS to real contacts, ever. `ENABLE_TEST_ALERT` stays
  unset (default-deny) unless a supervised test explicitly sets it.
- [ ] **No test data in live tables.** Before any demo / video /
  submission, check `sos_alerts` and `guardians` for rows created
  by testing and delete them (SQL Editor, by id, after a backup).
  A demo alert left in the table is a fake SOS in the record.
- [ ] **Delete the test users.** Supabase → Auth → Users: any
  user created only for testing is deleted after the test. The
  2026-11-14 clean-slate deletion (3 users) is the precedent.
- [ ] **Test OTP codes expire in 10 minutes and are single-use —
  do not screenshot a live code into a demo video or a submission
  recording.** A code visible in a video is a code anyone can use
  within its window.
- [ ] **The Day-30 final APK is the only "live" APK.** Test APKs
  (#9–#12) are UI-test builds: live SOS/SMS/backend stay off
  until the Day-30 `API_SECRET` activation. Do not hand a test APK
  to anyone as if it were the finished app.

## H12 — Domains, email authentication, and the sending domain

There is **no custom SafeLife domain today**: the backend, landing,
and web app all run on `*.vercel.app` subdomains, and mail is sent
from Gmail / Supabase's own sender. That means:

- [ ] **SPF / DKIM / DMARC: not applicable yet — and that is the
  honest answer.** These records belong to a domain that sends
  mail. SafeLife sends no mail from its own domain today, so there
  is nothing to set. Do NOT invent records for a domain that does
  not exist.
- [ ] **If a custom domain is ever added** (e.g. `safelife.app`
  for the landing page, or a custom sender domain for mail), then
  in the domain registrar's DNS, on day one:
  1. **SPF:** a `TXT` record authorising the mail sender(s)
     (e.g. Supabase / the chosen mail provider) — and no one else.
  2. **DKIM:** the provider's DKIM key as a `TXT` record, and
     confirm the provider reports DKIM "pass" on a test mail.
  3. **DMARC:** a `TXT` record at `_dmarc.<domain>` starting at
     `p=none` (monitor), moving to `p=quarantine` then `p=reject`
     only after the reports show no legitimate mail failing.
  4. Verify with the provider's own checker + a test mail to a
     Gmail inbox (check "Show original" → SPF/DKIM/DMARC all PASS).
- [ ] **Domain 2FA / registrar lock:** when a domain is bought,
  turn on 2FA on the registrar account and enable registrar lock /
  transfer lock. A stolen domain is a stolen identity for the app.
- [ ] **No lookalike domains:** if a custom domain is bought, also
  check the obvious typosquats are not already registered by
  someone else — and do not buy them pre-emptively without a
  reason; just know they exist.
- [ ] **Subdomain hygiene:** the Vercel projects' auto-assigned
  `*.vercel.app` domains are fine as-is. If a custom domain is
  attached, keep the `vercel.app` domain working as a fallback
  (do not delete it) so a DNS mistake does not take the app down.

## Review cadence

Re-check this file quarterly: re-confirm 2FA is still on everywhere
(it can be silently turned off by a recovery flow), re-list test
accounts, and re-confirm no custom domain has been added without
the H12 steps. Date each review here:

- 2026-11-16 — checklist created (run-6). Not yet actioned.
- (add new dated lines below as reviews happen)
