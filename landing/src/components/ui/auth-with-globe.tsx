"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight, Download, Globe, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlobeWireframe } from "@/components/ui/contact-with-globe";
import { supabase, AUTH_REDIRECT_URL } from "@/lib/supabase";

const smoothEase = [0.25, 0.1, 0.25, 1] as const;

const WEB_APP_URL = "https://safelife-ai.vercel.app";
const RELEASES_URL =
  "https://github.com/r1shabhsharma05/Saftey-App/releases";
const REPO_URL = "https://github.com/r1shabhsharma05/Saftey-App";

// GitHub mark — lucide-react no longer ships brand icons.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.56-5.16 3.56-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.6 4.58 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z"
      />
    </svg>
  );
}

const AUTH_LINKS = [
  {
    icon: Globe,
    label: "Open the SafeLife web app",
    href: WEB_APP_URL,
  },
  {
    icon: Download,
    label: "Download the Android APK",
    href: RELEASES_URL,
  },
  {
    icon: GithubIcon,
    label: "github.com/r1shabhsharma05/Saftey-App",
    href: REPO_URL,
  },
];

const inputClass =
  "w-full bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 outline-none focus:border-white/60 dark:focus:border-white/50 focus:ring-2 focus:ring-white/10 transition-colors duration-200";

type Mode = "signin" | "signup" | "forgot" | "reset";
type View =
  | { kind: "form" }
  | { kind: "check-email"; email: string }
  | { kind: "signed-in"; email: string };

export default function AuthWithGlobe({
  className,
}: {
  className?: string;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [view, setView] = useState<View>({ kind: "form" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The Supabase client reads the auth hash at import time, so by the
  // time this runs the session is already recovered. A recovery link
  // (type=recovery) means "set a new password"; a plain session means
  // signed in. Clean the tokens out of the address bar afterwards.
  useEffect(() => {
    const hash = window.location.hash;
    const isRecovery = hash.includes("type=recovery");
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        if (isRecovery) setMode("reset");
        else
          setView({
            kind: "signed-in",
            email: data.session.user.email ?? "",
          });
      }
    });
    if (hash.includes("access_token")) {
      window.history.replaceState(null, "", "#auth");
    }
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          setView({ kind: "signed-in", email: session.user.email ?? "" });
        } else {
          setView({ kind: "form" });
        }
      },
    );
    return () => listener.subscription.unsubscribe();
  }, []);

  const title =
    mode === "signup"
      ? "Create your account"
      : mode === "forgot"
        ? "Reset your password"
        : mode === "reset"
          ? "Choose a new password"
          : "Welcome back";
  const description =
    mode === "signup"
      ? "One SafeLife account — the same sign-in as the Android app and the web app. Your guardians and alerts stay with you."
      : mode === "forgot"
        ? "Enter the email on your account and we'll send you a reset link."
        : mode === "reset"
          ? "Enter a new password for your account."
          : "Sign in to your SafeLife account — the same sign-in as the Android app and the web app.";

  const validate = (): string => {
    if (!email.includes("@")) return "Enter a valid email address.";
    if (mode === "signup" || mode === "reset") {
      if (password.length < 6 && mode === "signup")
        return "Password must be at least 6 characters.";
      if (mode === "signup" && password !== confirm)
        return "Passwords do not match.";
      if (mode === "reset" && newPassword.length < 6)
        return "Password must be at least 6 characters.";
    }
    if ((mode === "signin" || mode === "signup") && password.length === 0)
      return "Enter your password.";
    return "";
  };

  const handleSubmit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name || undefined },
            emailRedirectTo: AUTH_REDIRECT_URL,
          },
        });
        if (error) throw error;
        setView({ kind: "check-email", email });
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: AUTH_REDIRECT_URL,
        });
        if (error) throw error;
        setView({ kind: "check-email", email });
      } else {
        const { error } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (error) throw error;
        setView({ kind: "form" });
        setMode("signin");
        setError("Password updated — sign in with your new password.");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError("");
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: AUTH_REDIRECT_URL },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setView({ kind: "form" });
    setMode("signin");
    setPassword("");
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setPassword("");
    setConfirm("");
  };

  return (
    <section
      className={cn(
        "relative w-full bg-black dark:bg-black overflow-hidden py-20",
        className,
      )}
    >
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="flex flex-col items-start text-left gap-4 mb-12">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.15, ease: smoothEase }}
            className="text-4xl md:text-5xl lg:text-6xl font-bold text-zinc-900 dark:text-white"
          >
            {title}
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.3, ease: smoothEase }}
            className="text-base text-zinc-500 dark:text-zinc-400 max-w-md"
          >
            {description}
          </motion.p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 max-w-5xl mx-auto items-start">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 1.0, delay: 0.2, ease: smoothEase }}
            className="flex flex-col gap-6"
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-xl font-semibold text-zinc-900 dark:text-white">
                Your safety, everywhere
              </h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed max-w-xs">
                One tap SOS, live tracking, guardians and SafeRoute — on
                Android, iOS and Web, under one account.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {AUTH_LINKS.map(({ icon: Icon, label, href }, i) => (
                <motion.a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    duration: 0.5,
                    delay: 0.3 + i * 0.1,
                    ease: smoothEase,
                  }}
                  className="group flex items-center gap-3 w-fit text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors duration-200"
                >
                  <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 group-hover:border-white/40 dark:group-hover:border-white/30 group-hover:bg-white/10 dark:group-hover:bg-white/10 flex items-center justify-center shrink-0 transition-colors duration-200">
                    <Icon className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 group-hover:text-white dark:group-hover:text-white transition-colors duration-200" />
                  </div>
                  {label}
                </motion.a>
              ))}
            </div>

            <div className="relative overflow-hidden h-52">
              <GlobeWireframe
                className="w-full aspect-square max-w-full absolute top-0 left-0"
                variant="wireframesolid"
                autoRotate
                autoRotateSpeed={0.45}
                strokeWidth={0.6}
                graticuleOpacity={0.12}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black dark:from-black to-transparent" />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 1.0, delay: 0.35, ease: smoothEase }}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-[#0a0a0a] dark:bg-[#0a0a0a] p-6 sm:p-8 flex flex-col gap-5"
          >
            {view.kind === "check-email" ? (
              <div className="flex flex-col gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black">
                  <Shield className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                  Check your inbox
                </h3>
                <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {mode === "signup"
                    ? `We sent a confirmation link to ${view.email}. Open it to activate your account, then sign in here.`
                    : `We sent a password-reset link to ${view.email}. Open it to choose a new password.`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setView({ kind: "form" });
                    setMode("signin");
                  }}
                  className="w-fit text-sm font-medium text-white underline underline-offset-4 hover:text-zinc-300"
                >
                  Back to sign in
                </button>
              </div>
            ) : view.kind === "signed-in" ? (
              <div className="flex flex-col gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-black">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
                    You&apos;re signed in
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {view.email}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                  This is the same account the SafeLife app uses. Open the
                  web app or download the APK — sign in there with this email
                  to pick up your guardians and alerts.
                </p>
                <a
                  href={WEB_APP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-black transition-opacity hover:opacity-90"
                >
                  Open web app
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href={RELEASES_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/25 text-sm font-semibold text-white transition-colors hover:border-white hover:bg-white hover:text-black"
                >
                  <Download className="h-4 w-4" />
                  Download APK
                </a>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-fit text-sm font-medium text-zinc-400 underline underline-offset-4 hover:text-white"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <>
                {(mode === "signin" || mode === "signup") && (
                  <div className="flex rounded-full border border-white/10 bg-zinc-900/60 p-1">
                    <button
                      type="button"
                      onClick={() => switchMode("signin")}
                      className={cn(
                        "h-9 flex-1 rounded-full text-sm font-semibold transition-colors",
                        mode === "signin"
                          ? "bg-white text-black"
                          : "text-zinc-400 hover:text-white",
                      )}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode("signup")}
                      className={cn(
                        "h-9 flex-1 rounded-full text-sm font-semibold transition-colors",
                        mode === "signup"
                          ? "bg-white text-black"
                          : "text-zinc-400 hover:text-white",
                      )}
                    >
                      Create account
                    </button>
                  </div>
                )}

                {(mode === "signin" || mode === "signup") && (
                  <>
                    <Button
                      onClick={handleGoogle}
                      disabled={busy}
                      className="h-11 w-full rounded-xl bg-white font-semibold text-sm text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
                    >
                      <GoogleIcon className="h-4 w-4" />
                      Continue with Google
                    </Button>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span className="h-px flex-1 bg-white/10" />
                      or continue with email
                      <span className="h-px flex-1 bg-white/10" />
                    </div>
                  </>
                )}

                {mode === "signup" && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                      Full name
                    </label>
                    <input
                      type="text"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                )}

                {mode !== "reset" && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                      Email address
                    </label>
                    <input
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                )}

                {mode === "reset" ? (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                      New password
                    </label>
                    <input
                      type="password"
                      placeholder="At least 6 characters"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                ) : (
                  mode !== "forgot" && (
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                        Password
                      </label>
                      <input
                        type="password"
                        placeholder="Your password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSubmit();
                        }}
                        className={inputClass}
                      />
                    </div>
                  )
                )}

                {mode === "signup" && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-medium text-zinc-400 dark:text-zinc-500">
                      Confirm password
                    </label>
                    <input
                      type="password"
                      placeholder="Repeat your password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSubmit();
                      }}
                      className={inputClass}
                    />
                  </div>
                )}

                {error && (
                  <p className="text-sm leading-relaxed text-red-400">
                    {error}
                  </p>
                )}

                <Button
                  onClick={handleSubmit}
                  disabled={busy}
                  className="h-11 w-full rounded-xl font-semibold text-sm bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-100 text-white dark:text-zinc-900 group disabled:opacity-60"
                >
                  {busy
                    ? "Please wait…"
                    : mode === "signin"
                      ? "Sign in"
                      : mode === "signup"
                        ? "Create account"
                        : mode === "forgot"
                          ? "Send reset link"
                          : "Update password"}
                  <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                </Button>

                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => switchMode("forgot")}
                    className="w-fit text-sm font-medium text-zinc-400 underline underline-offset-4 hover:text-white"
                  >
                    Forgot your password?
                  </button>
                )}
                {(mode === "forgot" || mode === "reset") && (
                  <button
                    type="button"
                    onClick={() => switchMode("signin")}
                    className="w-fit text-sm font-medium text-zinc-400 underline underline-offset-4 hover:text-white"
                  >
                    Back to sign in
                  </button>
                )}
                {mode === "signup" && (
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    Creating an account sends a confirmation email — open the
                    link to activate it before signing in.
                  </p>
                )}
              </>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
