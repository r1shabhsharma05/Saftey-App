// 🔐 Signup phone verification — SafeLife phone-OTP signup.
//
// POST /auth/signup/request-code {phone} → SMS a 6-digit code.
// POST /auth/signup/verify-code {phone, code} → server-side verdict.
//
// Why NO requireApiKey here (deliberate, unlike the guardian
// routes): the gate fail-closes 503 while API_SECRET is unset, and
// API_SECRET lands on Day 30 — gating these would make the new
// signup flow dead until then, and the user ordered this flow to
// work now. Abuse is bounded instead by codeLimiter (10/hr per IP),
// the per-phone 3/hr ledger inside issueCode, and the 5-attempt
// code kill (which also records a code-brute-force strike, same as
// the guardian verify). The code proves phone ownership only;
// account creation still needs the caller's own email + password
// via Supabase. Re-gate on Day 30 if wanted.
//
// SMS honesty (same as the guardian flow): while the SMS adapter is
// unconfigured, request-code answers 503 `channel-not-configured`
// and issues NO code — a code nobody can receive must not exist.
// The code itself never leaves the server except inside the SMS.
const express = require("express");
const { codeLimiter, trackingLimiter } = require("../middleware/rateLimit");
const { normalizePhone, smsStatus, sendSms } = require("../services/sms");
const { issueSignupCode, verifySignupCode } = require("../services/signupCode");
const { dbStatus, dbSelectBy, dbSelectBySuffix } = require("../services/supabaseDb");
const { recordStrike } = require("../services/strikes");
const { audit } = require("../services/audit");

const router = express.Router();

// 📲 REQUEST CODE — SMS the 6-digit code to the signing-up phone.
router.post("/auth/signup/request-code", codeLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (!smsStatus().configured) {
    audit("signup.code_denied", { ip: req.ip, meta: { reason: "channel-not-configured" } });
    return res.status(503).json({
      success: false,
      sent: false,
      reason: "channel-not-configured",
      error: "SMS verification is not configured yet — the code cannot be sent",
    });
  }
  let code;
  try {
    ({ code } = await issueSignupCode(phone));
  } catch (err) {
    const msg = err.message;
    if (/Too many verification codes/.test(msg)) {
      return res.status(429).json({ success: false, sent: false, error: msg });
    }
    if (/Too many pending/.test(msg)) {
      return res.status(503).json({ success: false, sent: false, error: msg });
    }
    return res.status(400).json({ success: false, sent: false, error: msg });
  }
  // The code stays issued even if the SMS fails — a re-request
  // overwrites it — but the response says so honestly (sent:false),
  // so the app never shows "code sent" for a code that never left.
  const sent = await sendSms({
    to: phone,
    content: `SafeLife verification code: ${code}. It expires in 10 minutes. If you did not ask for this, ignore it.`,
  });
  audit("signup.code_requested", { ip: req.ip, meta: { sent: sent.sent } });
  if (sent.sent === 0) {
    return res.status(502).json({ success: false, sent: false, reason: sent.reason || "sms-failed", error: "The verification code could not be sent — please try again" });
  }
  res.json({ success: true, sent: true });
});

// ✅ VERIFY CODE — the verdict comes from the server only. Wrong
// guesses count (5 kills the code); expired / already-answered codes
// are 409, not 400 — the state, not the input, is wrong. This rides
// the tracking bucket like the guardian verify (no SMS is spent
// here — the 5-attempt kill is the brute-force bound); only
// request-code rides the tighter codeLimiter.
router.post("/auth/signup/verify-code", trackingLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = req.body.code;
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, error: "Invalid verification code" });
  }
  try {
    await verifySignupCode(phone, code);
  } catch (err) {
    const msg = err.message;
    // A killed code is the brute-force signal — 5 wrong guesses from
    // one IP is a strike. A single typo is not abuse, so other verify
    // errors do not strike (same rule as the guardian verify).
    if (/Too many attempts/.test(msg)) recordStrike(`ip:${req.ip}`, "code-brute-force");
    const status = /No verification code pending|expired|Too many attempts/.test(msg) ? 409 : 400;
    audit("signup.verify_denied", { ip: req.ip });
    return res.status(status).json({ success: false, error: msg });
  }
  audit("signup.verified", { ip: req.ip });
  res.json({ success: true, verified: true });
});

// 📧 LOGIN RESOLVE — phone → account email, for phone-number login.
// Supabase auth is email-based, so the app resolves the email for a
// phone and then signs in with it. Returns ONLY the email: no name,
// no id, nothing else on the account. A phone with no account answers
// the same generic 404 as any other miss, and trackingLimiter bounds
// enumeration (60/min per IP). Same no-requireApiKey rule as the
// signup endpoints above — gating would 503 until Day 30, and login
// by phone has to work now. A DB outage is an honest 502, never a
// 404 that would claim "no account" for a lookup that never ran.
router.post("/auth/login/resolve", trackingLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (!dbStatus().configured) {
    return res.status(503).json({ success: false, error: "Login by phone is not configured yet" });
  }
  // Exact match first (phones saved normalized), then last-10-digits
  // for rows written with the phone as typed.
  const lookup = async () => {
    const exact = await dbSelectBy("profiles", "phone", phone);
    if (exact.ok) return { row: exact.row };
    if (exact.reason !== "not_found") return { error: true };
    const suffix = await dbSelectBySuffix("profiles", "phone", phone.slice(-10));
    if (suffix.ok) return { row: suffix.row };
    if (suffix.reason !== "not_found") return { error: true };
    return { row: null };
  };
  const found = await lookup();
  if (found.error) {
    return res.status(502).json({ success: false, error: "Could not look up the account — please try again" });
  }
  const row = found.row;
  if (!row || typeof row.email !== "string" || !row.email.includes("@")) {
    audit("login.resolve_miss", { ip: req.ip });
    return res.status(404).json({ success: false, error: "Account not found" });
  }
  audit("login.resolved", { ip: req.ip });
  res.json({ success: true, email: row.email });
});

module.exports = router;
