// 🤖 Cloudflare Turnstile — proof-of-humanity for the code-request forms (6.3).
//
// verifyTurnstile(token) POSTs the token to Cloudflare's siteverify
// with TURNSTILE_SECRET_KEY. Wired into POST /auth/signup/request-code
// and the guardian code request BEFORE any code is issued, so a bot
// cannot burn real SMS spend without solving the challenge.
//
// Fail-open while unconfigured (documented temporary state): when
// TURNSTILE_SECRET_KEY is unset the check is SKIPPED with one server
// warning — the flow must keep working until Rishabh creates the
// Turnstile keys. Once the secret is set, a missing/invalid token is
// a hard 400. The secret never leaves the server; only booleans are
// returned.
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

let warned = false;

const verifyTurnstile = async (token, { fetchImpl = fetch } = {}) => {
  const secret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!secret) {
    if (!warned) {
      warned = true;
      console.warn(
        "⚠️  TURNSTILE_SECRET_KEY is not set — code requests skip human verification (fail-open). " +
          "Set it in Vercel env once the Cloudflare Turnstile keys exist."
      );
    }
    return { ok: true, skipped: true };
  }
  if (typeof token !== "string" || !token) {
    return { ok: false, reason: "missing-token" };
  }
  try {
    const res = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    return data?.success ? { ok: true } : { ok: false, reason: "turnstile-failed" };
  } catch {
    return { ok: false, reason: "turnstile-transport-error" };
  }
};

module.exports = { verifyTurnstile };
