// 🚨 SOS alert lifecycle — the D3 state machine (plan §6 D3, amended A2).
//
// States: created → dispatching → delivered → acked → closed, plus
// failed. `failed` is the one deliberate extension to the plan's chain:
// dispatching → failed on total delivery failure, failed → dispatching
// on retry (D4's retry path). Without it a failed alert would sit in
// "dispatching" forever — a lie about its state. `closed` is terminal.
//
// Pure module, no I/O: routes own persistence (services/alertStore.js),
// D4/D10 own the ack + escalation transitions that use these states.
const crypto = require("crypto");

const ALERT_STATES = ["created", "dispatching", "delivered", "acked", "closed", "failed"];

const ALLOWED_TRANSITIONS = {
  created: ["dispatching"],
  dispatching: ["delivered", "failed"],
  delivered: ["acked", "closed"],
  acked: ["closed"],
  failed: ["dispatching"],
  closed: [],
};

const createAlert = ({ contactsCount = 0, lat, lng } = {}) => {
  const now = new Date().toISOString();
  const alert = {
    id: crypto.randomUUID(),
    state: "created",
    sent: 0,
    failed: 0,
    contacts: contactsCount,
    createdAt: now,
    updatedAt: now,
    // D10: contact acknowledgements. Each entry is {key, at} where key
    // is the one-way hash of the contact's phone/token (ackKeyFor) —
    // never the raw identifier. The escalation ladder stops at 2
    // distinct acks; acks live beside the lifecycle, not in it (an
    // ack is not a state transition by itself — the route moves
    // delivered→acked on the first one, and stays acked after).
    acks: [],
    history: [{ state: "created", at: now }],
  };
  // D9: the SOS trigger position rides on the alert record so the
  // contacts-side alert page has a location to show before any
  // /location-update arrives. Only finite numbers are stored —
  // callers validate ranges; this guard keeps a bad caller from
  // persisting NaN into the Postgres mirror.
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    alert.lat = lat;
    alert.lng = lng;
    alert.locationAt = now;
  }
  return alert;
};

// Records a newer live position on an existing alert. This is NOT a
// lifecycle transition (it must not move created→dispatching or
// disturb the delivery accounting): location updates are orthogonal
// to the state machine, and the route decides whether a closed alert
// still accepts them (it does not).
const setAlertLocation = (alert, lat, lng) => {
  const now = new Date().toISOString();
  alert.lat = lat;
  alert.lng = lng;
  alert.locationAt = now;
  alert.updatedAt = now;
  return alert;
};

// Moves the alert, records the step, and returns it. Throws on an
// illegal transition — callers must never silently record a state the
// machine cannot be in (a swallowed illegal transition would corrupt
// the delivery-receipt accounting D4 builds on).
const transition = (alert, to, note) => {  const allowed = ALLOWED_TRANSITIONS[alert.state] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal alert transition ${alert.state} -> ${to}`);
  }
  alert.state = to;
  alert.updatedAt = new Date().toISOString();
  alert.history.push({ state: to, at: alert.updatedAt, ...(note ? { note } : {}) });
  return alert;
};

// D10 ACK identity: a stable, one-way key for one contact, used to
// dedupe acknowledgements without storing the raw phone or token.
// Phones normalize first (formatting variants of one number are one
// contact); a pushToken-only contact keys on its token; no identifier
// at all keys on a single "anonymous" slot, so one contact refreshing
// the view page cannot ACK twice. The key is a truncated SHA-256 —
// enough to dedupe, and the raw identifier never reaches the alert
// record, the Postgres mirror, or an audit line. (A phone-number hash
// is brute-forceable by design of the phone space; that is accepted
// — the key carries no location or message, and the alternative,
// storing raw phones, is strictly worse.)
const ackKeyFor = ({ phone, pushToken } = {}) => {
  const cleanedPhone =
    typeof phone === "string" ? phone.replace(/[\s\-()]/g, "") : "";
  const id =
    /^\+?\d{10,15}$/.test(cleanedPhone)
      ? cleanedPhone
      : typeof pushToken === "string" && pushToken.trim()
        ? `token:${pushToken.trim()}`
        : "anonymous";
  return crypto.createHash("sha256").update(id).digest("hex").slice(0, 32);
};

// Records one contact's acknowledgement. Returns {isNew, counts,
// rejected}: a repeat ack from the same contact is a no-op, not a
// second vote. Pure except for mutating the alert record it is handed
// — the caller owns the delivered→acked transition (transition()
// above), so this never throws on state: recording that a human
// answered must not fail because of a state-machine edge.
//
// BINDING (audit H3): an ACK counts toward the 2-ack stop only when
// the identifier belongs to a contact this SOS actually went to —
// alert.contactKeys, stored at SOS time as one-way hashes of the
// contacts' phones/tokens. An identifier outside the set is rejected
// (the caller answers 400): anyone with the link could otherwise
// fabricate confirmations and stop the escalation while nobody came.
// An ack with no identifier at all keys on the single "anonymous"
// slot: it is recorded once (dedupe) but never counts — a refresh
// or a forwarded link must not stop the ladder. Alerts created
// before this binding carry no contactKeys (legacy): every
// identifier counts, as before, so old in-flight alerts keep working.
const ANONYMOUS_KEY = ackKeyFor({});

const countingAcks = (alert) => {
  const acks = Array.isArray(alert.acks) ? alert.acks : [];
  const bound =
    Array.isArray(alert.contactKeys) && alert.contactKeys.length > 0
      ? new Set(alert.contactKeys)
      : null;
  if (!bound) return acks;
  return acks.filter((a) => bound.has(a.key));
};

const recordAck = (alert, contact = {}) => {
  if (!Array.isArray(alert.acks)) alert.acks = [];
  const key = ackKeyFor(contact);
  if (alert.acks.some((a) => a.key === key)) return { isNew: false, counts: false };
  const bound =
    Array.isArray(alert.contactKeys) && alert.contactKeys.length > 0
      ? new Set(alert.contactKeys)
      : null;
  if (key === ANONYMOUS_KEY) {
    alert.acks.push({ key, at: new Date().toISOString() });
    alert.updatedAt = new Date().toISOString();
    return { isNew: true, counts: false };
  }
  if (bound && !bound.has(key)) return { isNew: false, counts: false, rejected: true };
  alert.acks.push({ key, at: new Date().toISOString() });
  alert.updatedAt = new Date().toISOString();
  return { isNew: true, counts: true };
};

module.exports = { ALERT_STATES, ALLOWED_TRANSITIONS, createAlert, transition, setAlertLocation, recordAck, countingAcks, ackKeyFor };
