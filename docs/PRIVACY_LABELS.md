# SafeLife data inventory → store privacy labels (H17)

Source of truth for what the app collects. Every line below is
grounded in the code at run-6 (2026-11-16): `mobile-app/`,
`Backend/`, `landing/public/privacy.html`, `supabase/migrations/`.
If a line changes, update this file in the same change — the store
answers must always match this inventory.

## 1. What the app collects

| Data | Where it comes from | Where it goes | Notes |
|---|---|---|---|
| Name (first + last) | Sign-up / Google sign-in, `profiles.first_name/last_name` | Supabase `profiles` | Shown on SOS alerts as the sender's name |
| Email | Sign-up / Google sign-in, `profiles.email` | Supabase `profiles`; Supabase Auth | Used for login, password reset, login-by-phone email lookup |
| Phone number | Sign-up / login, `profiles.phone` | Supabase `profiles` | E.164-normalised; login + forgot-password lookup key |
| Address | Not collected — nothing writes it; display card removed | Supabase `profiles` (column exists, always empty) | **H6 CLOSED:** no address is collected |
| Profile photo | Gallery pick, `profiles.avatar_url` (storage path only) | Supabase private `avatars` bucket, signed URLs | 5 MB cap, JPEG/PNG/WebP/GIF verified by bytes |
| Public user ID (`unique_id`, `SL-XXXXXXXX`) | Generated at profile creation | Supabase `profiles` | Display ID only; random since run-2 4.2 (CSPRNG, not `Math.random`) |
| Precise location | SOS alert + started journeys, incl. journey trail | Supabase `sos_alerts` / `journeys`; Telegram + SMS to chosen contacts; Mapbox / Overpass / OSRM to fetch map data | Only during SOS or a journey the user starts. No background tracking |
| Emergency contacts (names + phones) | User picks from device address book, `emergency_contacts` | Supabase `emergency_contacts` | Only the contacts the user selects are saved. **H6 CLOSED:** `expo-contacts` is justified — picking emergency contacts from the device address book is the core SOS flow |
| Guardians (names + phones) | User adds, `guardians` | Supabase `guardians` | Verified by 6-digit SMS code before they receive alerts |
| SOS alert details + status + battery level | SOS / battery-alert calls | Supabase `sos_alerts`; Telegram + SMS to chosen contacts | Battery level at alert time only |
| Voice audio (≤ 30 s per clip, ≤ 2 MB) + transcripts | Voice features (`/voice/transcribe`, `/voice/synthesize`) | Gnani Vachana (Prisma STT / Timbre TTS) | Sent only when the user uses a voice feature. See §3 for Gnani retention |
| Turnstile token | Sign-up / login code requests | Cloudflare Turnstile verification (`challenges.cloudflare.com`) | Bot check only; the secret key is server-side |
| Gnani usage counters (caller key `user:<id>` or `ip:<ip>`, day, count) | Server-side, per voice call | Supabase `gnani_daily_usage` | Cost guard (50/day). Caller key only — no audio, no transcript stored here |
| Auth session | Supabase Auth (JWT in `expo-secure-store`) | Device secure storage + Supabase Auth | No cookies, no server session store |

## 2. What the app does NOT collect

- **Payments:** no payment flow, no card / billing data. Grep
  `stripe|razorpay|paypal|payment|checkout|billing` over
  `Backend/ mobile-app/ landing/src/` returns 1 hit — the comment
  "billing boundary" in `Backend/services/voice.js:94` (a cost-guard
  note, not a payment feature).
- **Advertising / tracking SDKs:** no analytics, no ad pixels, no
  session recording, no crash reporter. Grep
  `analytics|mixpanel|amplitude|posthog|sentry|logrocket|hotjar|
  fullstory|clarity|gtag|facebook.*pixel|admob|adsense|intercom|
  crashlytics|appcenter` over source returns 0 real hits (18
  `package-lock.json` hits are the substring `tostringtag`
  matching `gtag`). No such dependency in any `package.json`.
- **Device identifiers for advertising:** no advertising ID, no
  `expo-device` usage. The only device-side identifiers are the
  Supabase user id and the `SL-` display id.
- **Push tokens:** NOT collected yet. There is no
  `expo-notifications` in the app; `mobile-app/utils/batteryAlerts.ts`
  confirms no `pushToken` is stored. FCM is server-side only and
  reports no-push-recipients until the app collects tokens.
- **Cookies:** none. The backend sets no cookies and keeps no
  server session (`cookie|req.session|express-session` grep: 0 hits).
- **Chat history / RAG:** none. `vector|embedding|rag|chat history`
  hits are "abuse vector" / "injection vector" comments and
  `@expo/vector-icons` imports only.
- **Contacts beyond the user's pick:** the app reads the address
  book only to offer the picker; only selected contacts are saved
  (H6 closed: the picker is the core SOS flow).

## 3. Gnani Vachana — what is known, what is not (H10)

Researched 2026-11-16 from public sources; no Vachana-API-specific
retention period is published anywhere found.

- **Training:** Gnani states "No customer voice data is used for
  model training without explicit agreement."
  (gnani.ai FAQ — https://www.gnani.ai/about-us). SafeLife has
  given no such agreement. There is no published self-serve
  opt-out toggle for the Vachana API; the protection is the
  no-training-without-agreement commitment itself.
- **Retention:** no fixed period is published for Vachana API
  audio/transcripts. Gnani's published privacy policy (Gnani
  Innovations Pvt. Ltd. — https://voicebiometrics.ai/privacy-policy/)
  states personal information "shall be retained till such time
  required for the Purpose or required under applicable law,
  whichever is later" and non-personal information "will be
  retained indefinitely". That is the honest answer: the period is
  not a number, it is purpose-or-law, whichever is later.
- **Deletion / withdrawal:** account deletion or a request to stop
  using personal information goes to `hello@gnani.ai`
  (same policy, "Mechanism to withdraw consent" section).
- **Residency / certifications:** Gnani states all training,
  deployment and hosting happen in India, with SOC 2 and ISO 27001
  certification and GDPR / HIPAA / PCI-DSS compliance (gnani.ai FAQ).
- The in-app privacy page (`landing/public/privacy.html`) states
  this plainly instead of inventing a number. If Gnani publishes a
  Vachana-specific retention period later, update the privacy page
  and this file together.

## 4. Play Store — Data safety answers

Fill the Data safety form from §1. The answers below are the ones
that follow from the inventory; Rishabh confirms them in the
Play Console (they are his submission, not Muse's).

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Yes — collects (below); shares with the service providers in §5 only |
| Personal info — Name | Collected (account), not shared except with SOS recipients the user chose |
| Personal info — Email | Collected (account), not shared |
| Personal info — Phone number | Collected (account + login), shared with chosen SOS recipients via SMS/Telegram only |
| Personal info — Address | Not collected (field exists in schema but nothing writes it; display removed) |
| Personal info — User IDs | Collected (Supabase user id + `SL-` display id), not shared |
| Photos | Collected (profile photo), not shared — private bucket, owner-only signed URLs |
| Location — Precise location | Collected (SOS + journeys only), shared with chosen contacts/guardians and map providers to fetch map data |
| Contacts | Collected (user-selected emergency contacts + guardians), shared with those contacts themselves as SOS recipients |
| Audio — Voice / sound recordings | Collected (voice features, ≤ 30 s), shared with Gnani Vachana for transcription/synthesis only |
| App activity — App interactions | Not collected |
| Financial info | Not collected |
| Health / fitness | Not collected |
| Messages | Not collected (SOS alerts are the user's own emergency messages to chosen contacts — declare as such if the form asks) |
| Device / other IDs | Not collected for advertising; no advertising ID |
| Data encrypted in transit? | Yes — HTTPS everywhere; Supabase, Gnani, Telegram, httpSMS all over TLS |
| Data deletable? | Yes — in-app **Profile → Delete account** wipes profile, contacts, guardians, journeys, SOS alerts, avatar. Copies already sent (SMS/Telegram) and Gnani-held audio cannot be recalled — stated in the privacy policy |
| Data collected for advertising / tracking? | No — no ads, no analytics, no tracking SDKs (§2) |
| Children | Not intended for under-18 without verifiable parental consent (DPDP Act) — stated in the privacy policy |

## 5. App Store — privacy label answers

Apple's labels use the same inventory. Map each §1 row to Apple's
data types:

| Apple data type | Collected? | Linked to user? | Used for tracking? |
|---|---|---|---|
| Contact Info — Name | Yes | Yes | No |
| Contact Info — Email Address | Yes | Yes | No |
| Contact Info — Phone Number | Yes | Yes | No |
| Contact Info — Physical Address | No — not collected | No | No |
| User Content — Photos or Videos | Yes (profile photo) | Yes | No |
| User Content — Audio Data | Yes (voice ≤ 30 s) | Yes | No |
| Location — Precise Location | Yes (SOS + journeys) | Yes | No |
| Contacts | Yes (user-selected) | Yes | No |
| Identifiers — User ID | Yes | Yes | No |
| Identifiers — Device ID | No | — | No |
| Purchases / Financial Info | No | — | No |
| Health & Fitness | No | — | No |
| Browsing / Search History | No | — | No |
| Usage Data / Diagnostics | No | — | No |
| Sensitive Info | No (voiceprints are not enrolled; Gnani voice cloning is not used — TTS uses Gnani's stock Nalini voice) | — | No |

Third-party sharing to declare: Supabase (hosting/auth/DB),
Telegram (SOS delivery), httpSMS (SMS), Gnani Vachana (voice),
Mapbox / Overpass / OSRM (maps), Google Maps (SOS link),
Cloudflare Turnstile (bot check), Firebase Cloud Messaging
(push — server-side only, no tokens collected yet).

## 6. Maintenance rule

Any new data collection (new permission, new SDK, new third-party,
new field) must land in §1 + the privacy page + this file in the
same change, before the store forms are re-submitted. A store
answer that no longer matches the code is a policy violation
waiting to happen.
