// 🔐 Phone-code service tests (run-2 R1d / R1e / R1j) + token expiry (2.5).
// Service-level: createPhoneCodeService over the signup store with a
// controllable fake PostgREST transport. No HTTP server here — the
// R1j 502 route check below it uses the real server.
const test = require("node:test");
const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { _setDbTransport, dbStatus } = require("../services/supabaseDb");
const signupCode = require("../services/signupCode");
const { escalationToken, verifyEscalationToken } = require("../services/escalation");
const {
  journeyEscalationToken,
  verifyJourneyEscalationToken,
} = require("../services/journeyEscalation");

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

process.env.API_SECRET = "phone-code-test-secret";

const PHONE = "+919876543210";
let calls;
let transportMode; // "ok" | "post-throws" | "patch-empty"

beforeEach(() => {
  calls = [];
  transportMode = "ok";
  signupCode._clearMemory();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  assert.equal(dbStatus().configured, true);
  _setDbTransport(async (call) => {
    calls.push(call);
    if (transportMode === "post-throws" && call.method === "POST") {
      throw new Error("db down");
    }
    if (transportMode === "patch-empty" && call.method === "PATCH") {
      return { data: [] }; // zero rows: another instance consumed it
    }
    if (call.method === "PATCH") return { data: [{ id: "row" }] };
    if (call.method === "GET") return { data: [] };
    return { data: null };
  });
});
after(() => {
  _setDbTransport(null);
  if (OLD_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = OLD_URL;
  if (OLD_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = OLD_KEY;
});

test("R1e: zero-row conditional consume → verify fails generic, code restored in memory", async () => {
  const { code } = await signupCode.issueSignupCode(PHONE);
  transportMode = "patch-empty";
  await assert.rejects(
    signupCode.verifySignupCode(PHONE, code),
    /Invalid or expired code/
  );
  // The code was restored, not dropped: with a winning PATCH it verifies.
  transportMode = "ok";
  const res = await signupCode.verifySignupCode(PHONE, code);
  assert.match(res.proof, /^\d+\.[0-9a-f]{64}$/);
});

test("R1j: mirror save failure on issue → throws, code rolled back, nothing pending", async () => {
  transportMode = "post-throws";
  await assert.rejects(
    signupCode.issueSignupCode(PHONE),
    /could-not-persist-code/
  );
  assert.equal(signupCode._hasPending(PHONE), false);
});

test("R1j: mirror save failure on verify → verify still succeeds, Postgres row deleted directly", async () => {
  const { code } = await signupCode.issueSignupCode(PHONE);
  transportMode = "post-throws";
  const res = await signupCode.verifySignupCode(PHONE, code);
  assert.match(res.proof, /^\d+\.[0-9a-f]{64}$/);
  // The retry also failed, so the verify path deleted the row directly.
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.url.includes("/rest/v1/signup_codes?"))
  );
});

test("R1d: the per-phone ledger survives consume — a consumed code keeps its window", async () => {
  const { code } = await signupCode.issueSignupCode(PHONE);
  await signupCode.verifySignupCode(PHONE, code);
  // The 3/hr cap cannot be reset by consuming: the ledger row lives
  // on after consume, so two more issues fill the window and a 4th
  // is refused — behaviourally proving the ledger survived.
  assert.equal(signupCode._hasPending(PHONE), false);
  await signupCode.issueSignupCode(PHONE);
  await signupCode.issueSignupCode(PHONE);
  await assert.rejects(signupCode.issueSignupCode(PHONE), /Too many verification codes/);
});

test("2.5: escalation + journey-escalation tokens expire (1h TTL)", () => {
  const past = Date.now() - 1000;
  const esc = escalationToken("alert-1", 2);
  assert.match(esc, /^\d+\.[0-9a-f]{64}$/);
  assert.equal(verifyEscalationToken("alert-1", 2, esc), true);
  assert.equal(verifyEscalationToken("alert-1", 2, escalationToken("alert-1", 2, past)), false);
  assert.equal(verifyEscalationToken("alert-1", 3, esc), false); // wrong step
  assert.equal(verifyEscalationToken("alert-1", 2, "a".repeat(64)), false); // old format

  const jesc = journeyEscalationToken("journey-1", "overdue-escalate");
  assert.match(jesc, /^\d+\.[0-9a-f]{64}$/);
  assert.equal(verifyJourneyEscalationToken("journey-1", "overdue-escalate", jesc), true);
  assert.equal(
    verifyJourneyEscalationToken("journey-1", "overdue-escalate", journeyEscalationToken("journey-1", "overdue-escalate", past)),
    false
  );
  assert.equal(
    verifyJourneyEscalationToken("journey-1", "checkin-escalate", jesc),
    false
  ); // wrong kind
});
