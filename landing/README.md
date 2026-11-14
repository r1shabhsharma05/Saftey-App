# SafeLife Landing Page

Marketing landing page for **SafeLife** — personal safety, one tap away.
Built with Vite + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui structure.

## Run

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (tsc + vite) → dist/
npm run preview  # serve the production build
```

## Design — Qronos-style (rebuilt from scratch)

The page follows the Qronos AI/SaaS template's look (21st.dev, @monolythdev)
as a visual reference — pure black, white particle vortex, huge centred
headline, pill CTAs, stack marquee, thin page frame — but every line of code
here is original, and all content is SafeLife's. The paid template's source
was not copied.

## What's inside

- **Hero** — white particle vortex canvas (`src/components/VortexCanvas.tsx`,
  funnel + ripple disc, `requestAnimationFrame`, reduced-motion safe) behind a
  huge centred headline "The personal safety system for every emergency",
  two pill CTAs (**DOWNLOAD APK** + **OPEN WEB APP**), pulsing SOS button,
  and a scrolling stack marquee (React Native, Expo, Node.js, Supabase…).
- **Product preview** — "SafeLife Command" dashboard mock: alert status, live
  location, escalation ladder, alert timeline, Safe Hub.
- **Insights** — KPI cards (162/162 tests, 30/15 min, 20 km, 0 mock) + a live
  system-status list (real states, including the blocked SMS + degraded
  safe-places — nothing dressed up).
- **Features** — One-tap SOS, Offline queue, Live tracking, Safe Hub, SafeRoute,
  Low-battery alerts.
- **How it works** — 4-step SOS flow.
- **Pricing** — "Free. Forever." (SafeLife is free — no tiers invented).
- **Contact** — `src/components/ui/contact-with-globe.tsx`: rotating D3 globe
  (wireframe, draggable) + contact form, restyled monochrome. Submit opens a
  pre-filled email to rishabhsharma14426@gmail.com (no form backend). Contact
  links are real: email, support inbox, GitHub repo. No personal phone number
  is published.

## shadcn structure

- `components.json` — shadcn config (`@/components`, `@/lib/utils`).
- `src/lib/utils.ts` — `cn()` helper.
- `src/components/ui/button.tsx` — shadcn Button.
- `src/components/ui/contact-with-globe.tsx` — contact section (globe + form).

## Notes

- Dark-first: the whole page forces `.dark` so the contact section's `dark:`
  variants always apply.
- `topojson-specification` is a **types-only** package — install
  `@types/topojson-specification`, not the runtime package (it has no npm
  versions).
- lucide-react no longer ships brand icons — the GitHub mark is inlined as SVG
  (`GithubIcon` in `App.tsx` / `contact-with-globe.tsx`).
- Modern Web Guidance applied: `parallax-scroll-effects` (hero) and
  `scroll-entry-exit-effects` (section reveals) — native CSS scroll-driven
  animations with `@supports` feature detection and `prefers-reduced-motion`
  guards, no polyfill.

## Deploy

Not deployed yet. Deploy to Vercel only on Rishabh's word — `npm run build`
produces a static `dist/` that any static host can serve.
