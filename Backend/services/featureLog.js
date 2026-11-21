// 📊 Anonymised feature logging — SafeLife 2.0 Day 29 (plan §3 F7).
//
// F7's rule: log anonymised features from day one; that log is the
// future training data for model v2. This is that log. One row per
// SOS / journey / risk-score call carrying ONLY:
//   - the event kind (sos | journey | risk_score)
//   - a coarse location cell (lat/lng rounded to 2 dp ≈ 1.1 km grid)
//   - the exact feature vector riskScore.js consumed + its output
// NEVER a user id, alert id, phone, name, or precise coordinate —
// the row cannot be tied back to a person (privacy by construction,
// not by policy). The table mirrors that: no owner column exists.
//
// Fire-and-forget, never throws (same degradation rule as
// supabaseDb.js): an unconfigured DB or a failed write costs only
// the log row, never the SOS. An in-memory ring keeps the last 200
// rows so local/dev runs and tests can read back what was logged.
const { dbStatus, dbUpsert } = require("./supabaseDb");
const { extractFeatures, scoreRisk, MODEL_VERSION } = require("./riskScore");

const KINDS = new Set(["sos", "journey", "risk_score"]);
const RING_MAX = 200;
const ring = [];

// ~1.1 km grid: precise enough for area-level training signal,
// coarse enough that a cell holds many people.
const coarseCell = (lat, lng) => {
  const la = typeof lat === "number" && Number.isFinite(lat) ? lat : null;
  const ln = typeof lng === "number" && Number.isFinite(lng) ? lng : null;
  if (la === null || ln === null || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return { cellLat: null, cellLng: null };
  }
  return { cellLat: Math.round(la * 100) / 100, cellLng: Math.round(ln * 100) / 100 };
};

// Builds one anonymised row from raw caller input. `extra` carries
// kind-specific non-PII facts (e.g. triggerSource, contactsCount) —
// allowlisted keys only, so a caller can never smuggle an identifier
// into the log by passing a fat object.
const EXTRA_KEYS = ["triggerSource", "contactsCount", "routePoints"];
const buildFeatureRow = ({ kind, lat, lng, input = {}, extra = {} } = {}) => {
  const { features } = extractFeatures(input);
  const { score, band } = scoreRisk(input);
  const safeExtra = {};
  for (const k of EXTRA_KEYS) {
    if (extra[k] !== undefined) safeExtra[k] = extra[k];
  }
  return {
    kind: KINDS.has(kind) ? kind : "risk_score",
    ...coarseCell(lat, lng),
    features,
    extra: safeExtra,
    score,
    band,
    modelVersion: MODEL_VERSION,
    ts: new Date().toISOString(),
  };
};

// Logs one event. Synchronous ring write + fire-and-forget DB mirror
// (dbUpsert never throws; the catch guards the impossible). Returns
// the row so callers/tests can assert on it. Never awaited by the
// SOS path — logging must not delay an emergency.
const logFeatureEvent = (event = {}) => {
  let row;
  try {
    row = buildFeatureRow(event);
  } catch {
    return null;
  }
  ring.push(row);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  if (dbStatus().configured) {
    dbUpsert("feature_events", {
      kind: row.kind,
      cell_lat: row.cellLat,
      cell_lng: row.cellLng,
      features: { ...row.features, ...row.extra },
      score: row.score,
      band: row.band,
      model_version: row.modelVersion,
      ts: row.ts,
    }).catch(() => {});
  }
  return row;
};

// Read-back for tests + the D29 audit: what has been logged this
// process, newest last. Not exposed over HTTP (the log is training
// data, not a product surface).
const recentFeatureEvents = () => ring.slice();

module.exports = { logFeatureEvent, buildFeatureRow, recentFeatureEvents, coarseCell };
