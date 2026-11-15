// 🔐 Signup / login phone verification + account deletion.
//
// POST /auth/signup/request-code {phone} → SMS a 6-digit code.
// POST /auth/signup/verify-code {phone, code} → mints a short-lived
//   single-use proof token binding the verified phone (R1c).
// POST /auth/signup/complete {proof, email, password, name, phone}
//   → verifies the proof and creates the account server-side.
// POST /auth/login/request-code {phone} → SMS a 6-digit login code.
// POST /auth/login/verify-code {phone, code} → returns {email} ONLY
//   after a verified code (R1h — the old /auth/login/resolve oracle
//   is DELETED; there is no phone→email lookup for unauthenticated
//   callers, and no last-10-digit suffix fallback anywhere).
// POST /auth/forgot-password {phone} → identical generic success
//   whether or not an account exists (2.3).
// DELETE /auth/account → deletes the auth user + all their rows and
//   avatar (12.3, JWT only).
//
// Run-2 oracles, all closed the same way: every verify failure is
// ONE status (400) + ONE generic message ("Invalid or expired code",
// R1i); a per-phone rate-limited request-code answers an
// indistinguishable {success:true, sent:true} (R1b); forgot-password
// never leaks existence (2.3); signup-complete never leaks "already
// registered". Abuse is bounded by codeLimiter (10/hr per IP),
// phoneCodeLimiter (5/min per normalized phone, 2.4), the per-phone
// 3/hr ledger inside issueCode, and the 5-attempt code kill (which
// also records a code-brute-force strike).
//
// SMS honesty (same as the guardian flow): while the SMS adapter is
// unconfigured, request-code answers 503 `channel-not-configured`
// and issues NO code — a code nobody can receive must not exist.
// The code itself never leaves the server except inside the SMS.
const express = require("express");
const { codeLimiter, trackingLimiter, phoneCodeLimiter } = require("../middleware/rateLimit");
const { requireUser } = require("../middleware/requireUser");
const { normalizePhone, smsStatus, sendSms } = require("../services/sms");
const { issueSignupCode, verifySignupCode } = require("../services/signupCode");
const { issueLoginCode, verifyLoginCode } = require("../services/loginCode");
const signupCodeStore = require("../services/signupCodeStore");
const { verifySignupProof } = require("../services/signupProof");
const { verifyTurnstile } = require("../services/turnstile");
const { dbStatus, dbSelectBy, dbSelectOne, dbDelete } = require("../services/supabaseDb");
const {
  adminCreateUser,
  adminDeleteUser,
  recoverPassword,
  deleteAvatarObject,
} = require("../services/supabaseAuth");
const { recordStrike } = require("../services/strikes");
const { audit } = require("../services/audit");

const router = express.Router();

// One generic message for every verify failure (R1i) — a caller
// must not learn whether a code was never issued, expired, killed,
// or merely mistyped.
const VERIFY_FAILED = "Invalid or expired code";

const isValidEmail = (email) =>
  typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

// Turnstile (6.3): when TURNSTILE_SECRET_KEY is set, a missing or
// invalid token is a hard 400 before any code is issued. When unset
// the check is skipped with a server warning (fail-open, temporary).
const checkTurnstile = async (req, res) => {
  const { ok } = await verifyTurnstile(req.body?.turnstileToken);
  if (ok) return true;
  audit("turnstile.denied", { ip: req.ip });
  res.status(400).json({ success: false, error: "Human verification failed — please try again" });
  return false;
};

// Shared request-code body: issue the code, SMS it, answer honestly.
// `issue` is issueSignupCode or issueLoginCode; `action` names the
// audit event. A per-phone ledger refusal (R1b) answers the SAME
// success as a fresh send — the caller cannot tell the phone was
// recently coded. A mirror-save failure (R1j) is a 502 and NO SMS.
const requestCode = async (req, res, { issue, action, smsText }) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (!smsStatus().configured) {
    audit(`${action}.code_denied`, { ip: req.ip, meta: { reason: "channel-not-configured" } });
    return res.status(503).json({
      success: false,
      sent: false,
      reason: "channel-not-configured",
      error: "SMS verification is not configured yet — the code cannot be sent",
    });
  }
  if (!(await checkTurnstile(req, res))) return;
  let code;
  try {
    ({ code } = await issue(phone));
  } catch (err) {
    const msg = err.message;
    if (/Too many verification codes/.test(msg)) {
      // R1b: indistinguishable from a fresh send — no 429, no error
      // text. The ledger refusal is audit-logged server-side only.
      audit(`${action}.code_denied`, { ip: req.ip, meta: { reason: "per-phone-cap" } });
      return res.json({ success: true, sent: true });
    }
    if (/could-not-persist-code/.test(msg)) {
      return res.status(502).json({
        success: false,
        sent: false,
        error: "The verification code could not be saved — please try again",
      });
    }
    return res.status(400).json({ success: false, sent: false, error: msg });
  }
  // The code stays issued even if the SMS fails — a re-request
  // overwrites it — but the response says so honestly (sent:false),
  // so the app never shows "code sent" for a code that never left.
  const sent = await sendSms({ to: phone, content: smsText(code) });
  audit(`${action}.code_requested`, { ip: req.ip, meta: { sent: sent.sent } });
  if (sent.sent === 0) {
    return res.status(502).json({ success: false, sent: false, reason: sent.reason || "sms-failed", error: "The verification code could not be sent — please try again" });
  }
  res.json({ success: true, sent: true });
};

// 📲 SIGNUP REQUEST CODE — SMS the 6-digit code to the signing-up phone.
router.post(
  "/auth/signup/request-code",
  phoneCodeLimiter,
  codeLimiter,
  (req, res) =>
    requestCode(req, res, {
      issue: issueSignupCode,
      action: "signup",
      smsText: (code) =>
        `SafeLife verification code: ${code}. It expires in 10 minutes. If you did not ask for this, ignore it.`,
    })
);

// ✅ SIGNUP VERIFY CODE — the verdict comes from the server only.
// Wrong guesses count (5 kills the code). Every failure is 400 +
// VERIFY_FAILED (R1i). On success the response carries the proof
// token (R1c) the complete step must present — the code proves phone
// ownership only; account creation still needs the proof.
router.post("/auth/signup/verify-code", trackingLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = req.body.code;
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, error: "Invalid verification code" });
  }
  let proof;
  try {
    ({ proof } = await verifySignupCode(phone, code));
  } catch (err) {
    const msg = err.message;
    // A killed code is the brute-force signal — 5 wrong guesses from
    // one IP is a strike. A single typo is not abuse, so other verify
    // errors do not strike (same rule as the guardian verify).
    if (/Too many attempts/.test(msg)) recordStrike(`ip:${req.ip}`, "code-brute-force");
    audit("signup.verify_denied", { ip: req.ip });
    return res.status(400).json({ success: false, error: VERIFY_FAILED });
  }
  audit("signup.verified", { ip: req.ip });
  res.json({ success: true, verified: true, proof });
});

// ✅ SIGNUP COMPLETE — create the account server-side (R1c). The
// proof binds (phone, expiry), is single-use (consumed here), and
// is verified against the signup_codes row — a caller who never
// verified the phone cannot create an account under any email, and
// a verified phone cannot be used to squat an arbitrary email
// without the proof. The account is created via the Supabase Admin
// API with email_confirm true (the phone was already proven).
router.post("/auth/signup/complete", trackingLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const proof = typeof req.body.proof === "string" ? req.body.proof : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim() : "";
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!phone || !proof || !isValidEmail(email) || password.length < 6 || !name || name.length > 100) {
    return res.status(400).json({ success: false, error: "Invalid signup details" });
  }
  const rec = await signupCodeStore.load(phone);
  if (!rec || !verifySignupProof(phone, proof, rec)) {
    audit("signup.complete_denied", { ip: req.ip });
    return res.status(400).json({ success: false, error: "Invalid or expired proof — please verify your phone again" });
  }
  // Single-use: consume the proof BEFORE creating the account, so a
  // replayed proof fails even if creation itself errors.
  rec.proof = null;
  rec.updatedAt = new Date().toISOString();
  await signupCodeStore.save(rec);
  const created = await adminCreateUser({ email, password, name, phone });
  if (!created.ok) {
    if (created.reason === "not_configured") {
      return res.status(503).json({ success: false, error: "Account creation is not configured yet" });
    }
    // Generic on purpose — an already-registered email must read
    // exactly like any other create failure (2.3).
    console.log("❌ signup complete failed:", created.reason);
    return res.status(400).json({ success: false, error: "Could not create account — please try again" });
  }
  audit("signup.completed", { ip: req.ip });
  res.json({ success: true });
});

// 📲 LOGIN REQUEST CODE — SMS the 6-digit login code (R1h). The
// email is never returned here; only a verified code (below) earns it.
router.post(
  "/auth/login/request-code",
  phoneCodeLimiter,
  codeLimiter,
  (req, res) =>
    requestCode(req, res, {
      issue: issueLoginCode,
      action: "login",
      smsText: (code) =>
        `SafeLife login code: ${code}. It expires in 10 minutes. If you did not ask for this, ignore it.`,
    })
);

// ✅ LOGIN VERIFY CODE — returns {email} ONLY after a verified code
// (R1h). Every failure is one generic 400 (R1i): wrong/expired code,
// no account for the phone, and lookup errors all read the same —
// the caller proved they own the phone, but nothing about whether
// an account exists may leak through the response shape. Lookup is
// by exact normalized phone only (no suffix fallback).
router.post("/auth/login/verify-code", phoneCodeLimiter, trackingLimiter, async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = req.body.code;
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, error: "Invalid verification code" });
  }
  try {
    await verifyLoginCode(phone, code);
  } catch (err) {
    if (/Too many attempts/.test(err.message)) recordStrike(`ip:${req.ip}`, "code-brute-force");
    audit("login.verify_denied", { ip: req.ip });
    return res.status(400).json({ success: false, error: VERIFY_FAILED });
  }
  if (!dbStatus().configured) {
    return res.status(503).json({ success: false, error: "Login by phone is not configured yet" });
  }
  const found = await dbSelectBy("profiles", "phone", phone);
  if (!found.ok || typeof found.row?.email !== "string" || !found.row.email.includes("@")) {
    if (!found.ok && found.reason !== "not_found") {
      console.log("❌ login email lookup failed:", found.reason);
    }
    audit("login.verify_denied", { ip: req.ip });
    return res.status(400).json({ success: false, error: VERIFY_FAILED });
  }
  audit("login.verified", { ip: req.ip });
  res.json({ success: true, email: found.row.email });
});

// 📧 FORGOT PASSWORD — server-side reset (2.3). The server looks up
// the email and triggers Supabase's reset email when one exists.
// The response is ALWAYS the same generic success, hit or miss —
// existence must never leak. A DB outage or a failed reset send is
// logged server-side only, never reflected in the response.
router.post("/auth/forgot-password", phoneCodeLimiter, trackingLimiter, async (req, res) => {
  const generic = { success: true, message: "If an account exists for this number, a password reset link has been sent." };
  const phone = normalizePhone(req.body.phone);
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (!dbStatus().configured) {
    console.log("❌ forgot-password: DB unconfigured, cannot look up email");
    return res.json(generic);
  }
  const found = await dbSelectBy("profiles", "phone", phone);
  if (!found.ok) {
    if (found.reason !== "not_found") {
      console.log("❌ forgot-password lookup failed:", found.reason);
    }
    return res.json(generic);
  }
  const email = found.row?.email;
  if (typeof email !== "string" || !email.includes("@")) {
    return res.json(generic);
  }
  const sent = await recoverPassword(email);
  if (!sent.ok) {
    console.log("❌ forgot-password reset send failed:", sent.reason);
  }
  audit("password.reset_requested", { ip: req.ip });
  res.json(generic);
});

// 🗑️ DELETE ACCOUNT (12.3) — JWT ONLY, no shared-key fallback.
// Deletes the auth user via the Admin API, then wipes every row the
// user owns (profiles, emergency_contacts, guardians, journeys,
// sos_alerts, signup_codes) plus the avatar object. Third-party
// copies (Telegram/httpSMS messages already sent, Gnani audio) cannot
// be recalled — that residue is documented in the privacy policy.
// Audit rows have no user column, so they are not wiped here; they
// carry no PII (fingerprints + ids only). In-memory store rows are
// unreachable after this: the JWT is dead, so requireUser 401s any
// later read of them.
router.delete("/auth/account", trackingLimiter, requireUser, async (req, res) => {
  const userId = req.user.id;
  const profile = await dbSelectOne("profiles", userId);
  const phone = profile.ok && typeof profile.row?.phone === "string" ? profile.row.phone : null;
  const deleted = await adminDeleteUser(userId);
  if (!deleted.ok) {
    if (deleted.reason === "not_configured") {
      return res.status(503).json({ success: false, error: "Account deletion is not configured yet" });
    }
    console.log("❌ account delete failed:", deleted.reason);
    return res.status(502).json({ success: false, error: "Could not delete account — please try again" });
  }
  const wipes = [
    dbDelete("profiles", "id", userId),
    dbDelete("emergency_contacts", "user_id", userId),
    dbDelete("guardians", "user_id", userId),
    dbDelete("journeys", "owner_id", userId),
    dbDelete("sos_alerts", "owner_id", userId),
    ...(phone ? [dbDelete("signup_codes", "phone", phone)] : []),
    deleteAvatarObject(userId),
  ];
  const results = await Promise.all(wipes);
  results.forEach((r, i) => {
    if (!r.ok && r.reason !== "not_configured") {
      console.log(`❌ account wipe ${i} failed:`, r.reason);
    }
  });
  audit("account.deleted", { ip: req.ip, meta: { userId } });
  res.json({ success: true });
});

module.exports = router;
