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
const transition = (alert, to, note) => {
  const allowed = ALLOWED_TRANSITIONS[alert.state] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal alert transition ${alert.state} -> ${to}`);
  }
  alert.state = to;
  alert.updatedAt = new Date().toISOString();
  alert.history.push({ state: to, at: alert.updatedAt, ...(note ? { note } : {}) });
  return alert;
};

module.exports = { ALERT_STATES, ALLOWED_TRANSITIONS, createAlert, transition, setAlertLocation };
