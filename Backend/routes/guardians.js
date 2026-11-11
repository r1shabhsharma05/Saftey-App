// 🛡️ Guardian onboarding routes — role, phone verification, availability
// (SafeLife 2.0 Day 19, plan §6 D19, plan §3 F2).
//
// Guard matrix (explicit, in one place): every route is API-key gated
// + tracking-limited (registration is not an SOS — it sends nothing
// to anyone except the verification SMS — so it rides the tracking
// bucket, not the SOS one). The verification code is the one secret
// in this flow: it is issued by the service, handed to the SMS
// adapter, and NEVER appears in any response, log line, or audit
// event — a read of one's own record must not leak the material a
// brute-force needs.
//
// Dedupe rule: one guardian per phone. A re-register of the same
// phone returns the existing record (name/role updated while pending,
// verified status never downgraded). A re-register with a DIFFERENT
// userId is 409 — one app user cannot claim another user's guardian
// record by re-registering its phone.
//
// SMS honesty (standing httpSMS blocker): while the SMS adapter is
// unconfigured, request-code answers 503 `verification-unavailable`
// and issues NO code — the guardian stays pending. The flow ships,
// live verification waits on the httpSMS key, same as D7/D9/D10.
const express = require("express");
const requireApiKey = require("../middleware/requireApiKey");
const { trackingLimiter } = require("../middleware/rateLimit");
const { sanitizeText } = require("../lib/validate");
const { normalizePhone, smsStatus, sendSms } = require("../services/sms");
const {
  GUARDIAN_ROLES,
  createGuardian,
  issueCode,
  verifyCode,
  setAvailable,
  toPublic,
} = require("../services/guardian");
const guardianStore = require("../services/guardianStore");
const { audit } = require("../services/audit");

const router = express.Router();

const loadGuardian = async (req, res) => {
  const guardian = await guardianStore.get(req.params.id);
  if (!guardian) {
    res.status(404).json({ success: false, error: "Guardian not found" });
    return null;
  }
  return guardian;
};

// 📝 REGISTER — become a guardian (or re-register the same phone).
// Validates name/phone/role; the service normalizes the phone and
// enforces the role allowlist. A verified record keeps its verified
// status and availability on re-register — only name/role move.
router.post("/guardians", trackingLimiter, requireApiKey, async (req, res) => {
  const userId = typeof req.body.userId === "string" ? req.body.userId.trim() : "";
  const name = sanitizeText(req.body.name, 100);
  const phone = normalizePhone(req.body.phone);
  const role = typeof req.body.role === "string" ? req.body.role : "";
  if (!userId || userId.length > 128) {
    return res.status(400).json({ success: false, error: "Invalid guardian user" });
  }
  if (!name) {
    return res.status(400).json({ success: false, error: "Invalid guardian name" });
  }
  if (!phone) {
    return res.status(400).json({ success: false, error: "Invalid phone number" });
  }
  if (!GUARDIAN_ROLES.includes(role)) {
    return res.status(400).json({ success: false, error: "Invalid guardian role" });
  }
  // One guardian per phone: an existing record for this phone is the
  // answer, not a duplicate. A different userId claiming the phone is
  // 409 — the record belongs to whoever registered it first.
  const existing = await guardianStore.getByPhone(phone);
  if (existing) {
    if (existing.userId !== userId) {
      audit("guardian.register_denied", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: existing.id } });
      return res.status(409).json({ success: false, error: "This phone is already registered to another guardian" });
    }
    existing.name = name;
    existing.role = role;
    existing.updatedAt = new Date().toISOString();
    guardianStore.save(existing);
    audit("guardian.registered", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: existing.id, deduped: true } });
    return res.json({ success: true, guardian: toPublic(existing) });
  }
  let guardian;
  try {
    guardian = createGuardian({ userId, name, phone, role });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (guardianStore.save(guardian) === false) {
    return res.status(503).json({ success: false, error: "Guardian store is full of verified guardians — please try again shortly" });
  }
  audit("guardian.registered", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: guardian.id } });
  res.json({ success: true, guardian: toPublic(guardian) });
});

// 📲 REQUEST VERIFICATION CODE — SMS the 6-digit code to the
// guardian's phone. Unconfigured SMS (the standing httpSMS blocker)
// is a 503 with NO code issued: a code nobody can receive must not
// exist. A verified guardian needs no code (409). The per-hour cap
// is a 429. The code itself never leaves the server except inside
// the SMS body.
router.post("/guardians/:id/request-code", trackingLimiter, requireApiKey, async (req, res) => {
  const guardian = await loadGuardian(req, res);
  if (!guardian) return;
  if (guardian.state === "verified") {
    return res.status(409).json({ success: false, error: "Guardian is already verified" });
  }
  if (!smsStatus().configured) {
    audit("guardian.code_denied", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: guardian.id, reason: "channel-not-configured" } });
    return res.status(503).json({
      success: false,
      sent: false,
      reason: "channel-not-configured",
      error: "SMS verification is not configured yet — the code cannot be sent",
    });
  }
  let code;
  try {
    ({ code } = issueCode(guardian));
  } catch (err) {
    return res.status(429).json({ success: false, sent: false, error: err.message });
  }
  // The code stays issued even if the SMS fails — a re-request
  // overwrites it — but the response says so honestly (sent:false),
  // so the app never shows "code sent" for a code that never left.
  const sent = await sendSms({
    to: guardian.phone,
    content: `SafeLife verification code: ${code}. It expires in 10 minutes. If you did not ask for this, ignore it.`,
  });
  guardianStore.save(guardian);
  audit("guardian.code_requested", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: guardian.id, sent: sent.sent } });
  if (sent.sent === 0) {
    return res.status(502).json({ success: false, sent: false, reason: sent.reason || "sms-failed", error: "The verification code could not be sent — please try again" });
  }
  res.json({ success: true, sent: true });
});

// ✅ VERIFY — the guardian enters the code. Wrong guesses count
// (5 kills the code); expired / already-answered codes are 409, not
// 400 — the state, not the input, is wrong. Attempts are persisted
// (store.save) on every path, so a brute-force cannot reset its
// counter by hitting a fresh instance.
router.post("/guardians/:id/verify", trackingLimiter, requireApiKey, async (req, res) => {
  const guardian = await loadGuardian(req, res);
  if (!guardian) return;
  const code = req.body.code;
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, error: "Invalid verification code" });
  }
  try {
    verifyCode(guardian, code);
  } catch (err) {
    guardianStore.save(guardian);
    const msg = err.message;
    const status = /No verification code pending|expired|Too many attempts/.test(msg) ? 409 : 400;
    audit("guardian.verify_denied", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: guardian.id } });
    return res.status(status).json({ success: false, error: msg });
  }
  guardianStore.save(guardian);
  audit("guardian.verified", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: guardian.id } });
  res.json({ success: true, guardian: toPublic(guardian) });
});

// 🟢 AVAILABILITY — the on/off-duty toggle. Verified-only: an
// unverified guardian must never receive a D20/D21 alert, so the
// toggle refuses while pending (409).
router.post("/guardians/:id/availability", trackingLimiter, requireApiKey, async (req, res) => {
  const guardian = await loadGuardian(req, res);
  if (!guardian) return;
  const available = req.body.available;
  if (typeof available !== "boolean") {
    return res.status(400).json({ success: false, error: "Invalid availability value" });
  }
  try {
    setAvailable(guardian, available);
  } catch (err) {
    return res.status(409).json({ success: false, error: err.message });
  }
  guardianStore.save(guardian);
  audit("guardian.availability", { actorKey: req.header("x-api-key"), ip: req.ip, meta: { guardianId: guardian.id, available } });
  res.json({ success: true, guardian: toPublic(guardian) });
});

// 🔍 GUARDIAN READ (owner read — what the app polls for the
// guardian home screen). API-key gated + tracking limiter. Same
// serverless caveat as GET /journey/:id: a record created on
// another instance is only visible here once Supabase is
// configured; unconfigured, only same-instance memory answers.
router.get("/guardian/:id", trackingLimiter, requireApiKey, async (req, res) => {
  const guardian = await loadGuardian(req, res);
  if (!guardian) return;
  res.json({ success: true, guardian: toPublic(guardian) });
});

module.exports = router;
