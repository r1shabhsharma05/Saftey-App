import { motion } from "motion/react";
import {
  Shield,
  Siren,
  WifiOff,
  MapPin,
  BatteryLow,
  Route,
  Download,
  CheckCircle2,
  ArrowRight,
  Activity,
  Bell,
  Crosshair,
  Timer,
} from "lucide-react";
import ContactWithGlobe from "@/components/ui/contact-with-globe";
import VortexCanvas from "@/components/VortexCanvas";

const RELEASES_URL =
  "https://github.com/r1shabhsharma05/Saftey-App/releases";
const WEB_APP_URL = "https://safelife-ai.vercel.app";
const REPO_URL = "https://github.com/r1shabhsharma05/Saftey-App";

const ease = [0.25, 0.1, 0.25, 1] as const;

// GitHub mark — lucide-react no longer ships brand icons.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

const MARQUEE = [
  "React Native",
  "Expo",
  "Node.js",
  "TypeScript",
  "Supabase",
  "Vercel",
  "Render",
  "Telegram",
];

const FEATURES = [
  {
    icon: Siren,
    title: "One-tap SOS",
    body: "A single tap sends an emergency alert with live GPS — never blocked waiting for a perfect fix. Confirmed working.",
  },
  {
    icon: WifiOff,
    title: "Offline SOS queue",
    body: "No signal? The alert is queued in the app outbox and sent automatically when connectivity returns — with backoff and delivery status.",
  },
  {
    icon: MapPin,
    title: "Live tracking",
    body: "While an alert is active, fresh coordinates keep streaming to the alert's live page, so contacts follow your movement.",
  },
  {
    icon: Shield,
    title: "Safe Hub",
    body: "Nearby police stations and safe places from real OpenStreetMap data — police within 20 km, everything else within 10 km.",
  },
  {
    icon: Route,
    title: "SafeRoute",
    body: "In-app walking route to the nearest-best safe place with distance + ETA. Live-probed: 1,629 m / 1,303 s / 69 polyline points.",
  },
  {
    icon: BatteryLow,
    title: "Low-battery alerts",
    body: "15% pre-alert while discharging, 5% final location burst during an active alert. Unknown readings never fire.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Tap SOS",
    body: "The button fires immediately. Last-known GPS first, fresh fix streams in after — an alert with slightly old coordinates always beats no alert.",
  },
  {
    n: "02",
    title: "Queue if offline",
    body: "No connectivity? The alert is stored in the outbox and sent automatically when the network returns.",
  },
  {
    n: "03",
    title: "Delivered in seconds",
    body: "The hardened backend fans the alert out to your guardians on Telegram — name, live location, maps link, emergency contacts.",
  },
  {
    n: "04",
    title: "Tracked live",
    body: "While the alert is live, the app keeps posting location updates. Two guardian ACKs stop the escalation ladder.",
  },
];

const KPIS = [
  { value: "162/162", label: "backend tests passing" },
  { value: "30 / 15 min", label: "SOS rate limit per IP" },
  { value: "20 km", label: "police-station search radius" },
  { value: "0", label: "mock data anywhere" },
];

// Real, current system status — no invented numbers.
const STATUS = [
  { name: "SOS flow", state: "Working", ok: true, note: "confirmed by the user, 23 Oct" },
  { name: "Backend API", state: "Live", ok: true, note: "Vercel, 162/162 tests" },
  { name: "Web app", state: "Live", ok: true, note: "safelife-ai.vercel.app" },
  { name: "Telegram alerts", state: "Live", ok: true, note: "@safe_alret_bot" },
  { name: "SMS alerts", state: "Blocked", ok: false, note: "httpSMS key returned 401 — needs re-check" },
  { name: "Safe places", state: "Degraded", ok: false, note: "live endpoint 502, mobile fallback covers" },
];

function SosButton() {
  return (
    <div className="relative flex items-center justify-center">
      <span
        aria-hidden
        className="absolute inline-flex h-44 w-44 rounded-full bg-white/20 animate-pulse-ring"
      />
      <span
        aria-hidden
        className="absolute inline-flex h-44 w-44 rounded-full bg-white/15 animate-pulse-ring [animation-delay:0.8s]"
      />
      <div className="relative flex h-44 w-44 flex-col items-center justify-center rounded-full bg-white text-black shadow-[0_0_90px_rgba(255,255,255,0.35)]">
        <Siren className="h-10 w-10" />
        <span className="text-2xl font-extrabold tracking-wide">SOS</span>
        <span className="text-[11px] font-semibold tracking-widest text-zinc-600">
          TAP TO ALERT
        </span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="dark min-h-screen bg-black font-sans text-zinc-50 antialiased overflow-x-clip">
      {/* ── Qronos-style thin frame around the whole page ── */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60] border border-white/10"
      />

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black">
              <Shield className="h-4.5 w-4.5" />
            </span>
            <span className="text-lg font-extrabold tracking-[0.18em]">
              SAFELIFE
            </span>
          </a>
          <nav className="hidden items-center gap-9 text-[15px] text-zinc-400 md:flex">
            <a href="#about" className="transition-colors hover:text-white">
              About
            </a>
            <a href="#features" className="transition-colors hover:text-white">
              Features
            </a>
            <a href="#insights" className="transition-colors hover:text-white">
              Insights
            </a>
            <a href="#download" className="transition-colors hover:text-white">
              Download
            </a>
            <a href="#contact" className="transition-colors hover:text-white">
              Contact
            </a>
          </nav>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-white/25 bg-transparent px-5 text-sm font-semibold tracking-wide text-white transition-colors hover:border-white hover:bg-white hover:text-black"
          >
            DOWNLOAD APK
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* ── Hero ── */}
      <section id="top" className="hero-parallax relative overflow-hidden">
        <VortexCanvas className="absolute inset-0 h-full w-full" />
        {/* fade the vortex under the headline for readability */}
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.55)_75%,#000_100%)]"
        />
        <div
          aria-hidden
          className="hero-layer absolute -top-32 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-white/[0.04] blur-[110px]"
          style={{ "--parallax": 1.4 } as React.CSSProperties}
        />

        <div className="relative mx-auto flex max-w-7xl flex-col items-center px-4 pb-16 pt-24 text-center sm:px-6 sm:pt-32">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-zinc-300"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            SOS confirmed working · Backend live
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.1, ease }}
            className="mt-8 max-w-6xl text-[clamp(2.9rem,7.2vw,6.5rem)] font-bold leading-[1.02] tracking-[-0.03em]"
          >
            The personal safety system
            <br />
            <span className="bg-gradient-to-b from-white via-white to-zinc-500 bg-clip-text text-transparent">
              for every emergency
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.22, ease }}
            className="mt-7 max-w-2xl text-lg leading-relaxed text-zinc-400"
          >
            One tap sends an emergency alert — your live location, your name,
            and your emergency contacts — to the people who protect you, in
            seconds. Even offline. Even on a dying phone.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.34, ease }}
            className="mt-10 flex flex-col items-center gap-4 sm:flex-row"
          >
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex h-13 items-center gap-2 rounded-full border border-white/30 bg-transparent px-8 py-3.5 text-sm font-bold tracking-wide text-white transition-colors hover:border-white hover:bg-white hover:text-black"
            >
              DOWNLOAD APK
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href={WEB_APP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-13 items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-bold tracking-wide text-black transition-opacity hover:opacity-90"
            >
              OPEN WEB APP
            </a>
          </motion.div>
          <p className="mt-3 text-xs text-zinc-500">
            Release APK ships 22 Nov 2026 — the button opens the releases page.
          </p>

          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.45, ease }}
            className="mt-14 sm:mt-16"
          >
            <SosButton />
          </motion.div>

          {/* ── Marquee (Qronos partner strip → SafeLife stack) ── */}
          <div className="relative mt-20 w-full overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
            <div className="flex w-max animate-marquee items-center gap-14 pr-14">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span
                  key={`${m}-${i}`}
                  className="whitespace-nowrap text-xl font-bold tracking-tight text-zinc-500"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Product preview (Qronos "product overview") ── */}
      <section id="about" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="reveal mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold tracking-[0.2em] text-zinc-400 uppercase">
            Product overview
          </p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Everything an emergency needs, in one screen
          </h2>
          <p className="mt-4 text-zinc-400">
            The SafeLife command view — alert status, guardians, live location
            and the escalation ladder, exactly as the app runs them.
          </p>
        </div>

        <div className="reveal mx-auto mt-14 max-w-5xl rounded-2xl border border-white/10 bg-[#0a0a0a] p-5 sm:p-7">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black">
                <Shield className="h-4 w-4" />
              </span>
              <span className="font-bold tracking-wide">SafeLife Command</span>
              <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Live
              </span>
            </div>
            <span className="hidden text-sm text-zinc-500 sm:block">
              Day 22 · Police layer
            </span>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Bell className="h-4 w-4" /> Alert status
              </div>
              <p className="mt-3 text-2xl font-bold">Ready</p>
              <p className="mt-1 text-sm text-zinc-500">
                SOS fires instantly — last-known GPS first, fresh fix streams in.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Crosshair className="h-4 w-4" /> Live location
              </div>
              <p className="mt-3 text-2xl font-bold">Streaming</p>
              <p className="mt-1 text-sm text-zinc-500">
                Fresh coordinates keep posting while an alert is active.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Timer className="h-4 w-4" /> Escalation
              </div>
              <p className="mt-3 text-2xl font-bold">2 ACKs stop it</p>
              <p className="mt-1 text-sm text-zinc-500">
                Two guardian acknowledgements stop the ladder. No ACK — it climbs.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Activity className="h-4 w-4" /> Alert timeline
              </div>
              <ul className="mt-3 space-y-2.5 text-sm">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  SOS tapped — alert created, GPS attached
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  Guardians notified on Telegram, seconds later
                </li>
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  Live page open — location updates streaming
                </li>
                <li className="flex items-center gap-2.5 text-zinc-500">
                  <span className="h-4 w-4 shrink-0 rounded-full border border-zinc-600" />
                  Offline? Queued in the outbox, sent on reconnect
                </li>
              </ul>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <MapPin className="h-4 w-4" /> Safe Hub — nearest help
              </div>
              <ul className="mt-3 space-y-2.5 text-sm">
                <li className="flex justify-between gap-3">
                  <span>Police station</span>
                  <span className="text-zinc-400">within 20 km</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span>Hospital / pharmacy</span>
                  <span className="text-zinc-400">within 10 km</span>
                </li>
                <li className="flex justify-between gap-3">
                  <span>SafeRoute to nearest place</span>
                  <span className="text-zinc-400">1,629 m · 22 min walk</span>
                </li>
                <li className="flex justify-between gap-3 text-zinc-500">
                  <span>Data source</span>
                  <span>real OpenStreetMap — no mocks</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Insights / KPI (Qronos "agent insights dashboard") ── */}
      <section id="insights" className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="reveal mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold tracking-[0.2em] text-zinc-400 uppercase">
              Insights
            </p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              Measured, not promised
            </h2>
            <p className="mt-4 text-zinc-400">
              Real numbers from the live system. Where something is broken, it
              says so — nothing is dressed up.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {KPIS.map((k) => (
              <div
                key={k.label}
                className="reveal rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 text-center"
              >
                <p className="text-3xl font-bold sm:text-4xl">{k.value}</p>
                <p className="mt-1.5 text-sm text-zinc-500">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="reveal mx-auto mt-6 max-w-5xl rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 sm:p-7">
            <h3 className="font-bold">Live system status</h3>
            <ul className="mt-4 divide-y divide-white/5">
              {STATUS.map((s) => (
                <li key={s.name} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span className="flex items-center gap-3 text-sm">
                    <span className="text-zinc-500">{s.note}</span>
                    <span
                      className={
                        s.ok
                          ? "inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
                          : "inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-xs font-medium text-amber-300"
                      }
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${s.ok ? "bg-emerald-400" : "bg-amber-400"}`}
                      />
                      {s.state}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="reveal mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold tracking-[0.2em] text-zinc-400 uppercase">
            Features
          </p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            A complete safety companion
          </h2>
          <p className="mt-4 text-zinc-400">
            Around one-tap SOS, SafeLife is everything you need when it matters
            most — verified numbers only, no mock data anywhere.
          </p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article
              key={f.title}
              className="reveal group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/30 hover:bg-white/[0.05]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white transition-colors group-hover:bg-white/20">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {f.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="border-y border-white/10 bg-white/[0.02]">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
          <div className="reveal mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold tracking-[0.2em] text-zinc-400 uppercase">
              How it works
            </p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
              Four steps. Seconds, not minutes.
            </h2>
          </div>
          <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <article key={s.n} className="reveal relative rounded-2xl border border-white/10 bg-[#0a0a0a] p-6">
                <span className="text-4xl font-extrabold text-white/20">
                  {s.n}
                </span>
                <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {s.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Free forever (Qronos pricing → SafeLife reality) ── */}
      <section id="download" className="mx-auto max-w-7xl px-4 py-24 sm:px-6">
        <div className="reveal mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold tracking-[0.2em] text-zinc-400 uppercase">
            Pricing
          </p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Free. Forever.
          </h2>
          <p className="mt-4 text-zinc-400">
            No paywall, no ads, no data selling. SafeLife is a personal safety
            project — the APK costs nothing, on Android, iOS and Web.
          </p>
        </div>
        <div className="reveal mx-auto mt-12 max-w-md rounded-2xl border border-white/15 bg-[#0a0a0a] p-8 text-center">
          <p className="text-5xl font-extrabold">₹0</p>
          <p className="mt-1 text-sm text-zinc-500">forever · all features</p>
          <ul className="mt-6 space-y-2.5 text-left text-sm text-zinc-300">
            {[
              "One-tap SOS + live tracking",
              "Offline queue + SafeRoute",
              "Safe Hub (police, hospitals)",
              "Low-battery alerts",
              "Android · iOS · Web",
            ].map((t) => (
              <li key={t} className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                {t}
              </li>
            ))}
          </ul>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-sm font-bold tracking-wide text-black transition-opacity hover:opacity-90"
          >
            <Download className="h-4 w-4" />
            DOWNLOAD APK
          </a>
          <p className="mt-3 text-xs text-zinc-500">
            Release APK ships 22 Nov 2026 — the button opens the releases page.
          </p>
        </div>
      </section>

      {/* ── Contact (globe form) ── */}
      <div id="contact">
        <ContactWithGlobe />
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-black">
              <Shield className="h-4 w-4" />
            </span>
            <div>
              <p className="font-bold leading-none tracking-[0.14em]">SAFELIFE</p>
              <p className="mt-1 text-xs text-zinc-500">
                Because in an emergency, every second — and every step — counts.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 text-sm text-zinc-400">
            <a href={WEB_APP_URL} target="_blank" rel="noreferrer" className="hover:text-white">
              Web app
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-white">
              <GithubIcon className="h-4 w-4" />
              GitHub
            </a>
            <a href={RELEASES_URL} target="_blank" rel="noreferrer" className="hover:text-white">
              Releases
            </a>
          </div>
          <p className="text-xs text-zinc-600">
            Built by Rishabh Sharma · SafeLife 2.0 — Day 30 release 22 Nov 2026
          </p>
        </div>
      </footer>
    </div>
  );
}
