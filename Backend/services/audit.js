// 📋 Admin-action audit log — structured JSON lines on stdout.
//
// Amendment A4 scope: security-relevant actions get an audit trail even
// before the Postgres audit table lands (D3 builds the real schema there).
// The sink is one swappable function on purpose: D3 replaces `writeSink`
// with the DB writer without touching any caller.
//
// What is logged: action name, timestamp, actor fingerprint, safe meta.
// NEVER the API key itself (only a sha256 fingerprint prefix — enough to
// correlate a bad actor's attempts), NEVER message bodies, names, phones
// or coordinates (PII stays out of audit lines).
const crypto = require("crypto");

// One-way fingerprint of a presented API key. Correlates attempts from the
// same caller without ever writing the secret to a log.
const fingerprint = (presentedKey) => {
  if (!presentedKey) return "none";
  return crypto
    .createHash("sha256")
    .update(String(presentedKey))
    .digest("hex")
    .slice(0, 16);
};

// The sink — D3 swaps this for the Postgres writer. Kept synchronous:
// audit must never delay or fail the request path it observes.
let writeSink = (line) => process.stdout.write(line + "\n");

const audit = (action, { actorKey, ip, meta } = {}) => {
  const entry = {
    ts: new Date().toISOString(),
    audit: true,
    action,
    actor: fingerprint(actorKey),
    ...(ip ? { ip } : {}),
    ...(meta ? { meta } : {}),
  };
  try {
    writeSink(JSON.stringify(entry));
  } catch {
    // Audit must never break the request it observes.
  }
};

module.exports = {
  audit,
  fingerprint,
  // Test seam only — lets tests capture lines without touching stdout.
  _setWriteSink: (fn) => {
    writeSink = fn;
  },
};
