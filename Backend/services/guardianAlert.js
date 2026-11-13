// 🛡️ Guardian alert flow — SafeLife 2.0 Day 21 (plan §6 D21, plan §3 F2).
//
// When an SOS fires, the verified on-duty guardians D20 can match are
// notified by SMS, can accept or decline, and — once accepted — share
// live location with the victim while both sides exchange preset
// messages. The state lives on the alert record (`alert.guardians`),
// mirrored to Postgres like the rest of the alert (services/
// alertStore.js); the pure functions here are unit-testable without
// any I/O, and only notifyGuardiansForAlert touches the network.
//
// Channels: SMS is the ONLY notify channel — guardian records carry
// a verified phone and nothing else addressable (no pushToken, no
// Telegram chat id). While SMS is unconfigured the notify honestly
// records notified: 0 with the sender's reason (same honesty pattern
// as D19 request-code), and no response exists to accept.
//
// Response window: 15 min, checked lazily on act (no timers exist on
// serverless — A2). Accept/decline are idempotent on repeat and
// terminal on switch. Chat-lite is preset keys only — no free text:
// the server renders the text from the key, so no client input ever
// reaches a screen or the view page unescaped.
//
// Privacy: guardian exact coordinates go to the victim's API-key
// read only (guardianAlertSummary, accepted guardians). The
// contacts-side view page gets counts + nearest distance, never
// coordinates (routes/alerts.js). The guardian's own read gets the
// VICTIM's pin — that is the point of accepting.
const { isValidLatitude, isValidLongitude } = require("../lib/validate");
const { normalizePhone, sendSms } = require("./sms");
const {
  haversineKm,
  findNearbyGuardians,
  DEFAULT_RADIUS_KM,
  DEFAULT_LIMIT,
} = require("./guardianMatch");
const guardianStore = require("./guardianStore");

const RESPONSE_WINDOW_MS = 15 * 60 * 1000; // a notified guardian older than this cannot respond
const MAX_MESSAGES = 50; // the log caps here, oldest dropped — a live coordination log, not an audit trail

// Preset messages only — keys are role-bound, text is server-rendered.
const PRESET_MESSAGES = {
  guardian: {
    "on-my-way": "I'm on my way to you",
    "almost-there": "Almost there — stay where you are",
    "calling-police": "I'm calling the police",
  },
  victim: {
    "please-hurry": "Please hurry",
    "i-am-safe": "I'm safe now — thank you",
    "call-police": "Please call the police",
  },
};

const newGuardianAlertState = () => ({ responses: {}, locations: {}, messages: [] });

// Records that a matched guardian was notified (the SMS may still
// have failed — the response exists so the app can show "matched but
// not reached" instead of pretending nobody is near).
const recordNotification = (state, { guardianId, name, role, distanceKm, score, nowMs = Date.now() } = {}) => {
  if (typeof guardianId !== "string" || !guardianId) throw new Error("Invalid guardian id");
  const response = {
    guardianId,
    name: typeof name === "string" ? name : "",
    role: typeof role === "string" ? role : "",
    state: "notified",
    distanceKm: typeof distanceKm === "number" ? distanceKm : null,
    score: typeof score === "number" ? score : null,
    notifiedAt: new Date(nowMs).toISOString(),
    respondedAt: null,
  };
  state.responses[guardianId] = response;
  return response;
};

// Terminal states never expire — only a guardian still sitting on
// "notified" goes stale.
const isExpired = (response, nowMs = Date.now()) => {
  if (!response || response.state !== "notified") return false;
  const t = Date.parse(response.notifiedAt);
  return Number.isFinite(t) && nowMs - t > RESPONSE_WINDOW_MS;
};

const acceptResponse = (state, guardianId, nowMs = Date.now()) => {
  const r = state.responses[guardianId];
  if (!r) throw new Error("Unknown guardian response");
  if (r.state === "accepted") return { already: true };
  if (r.state === "declined") throw new Error("Response already declined");
  if (isExpired(r, nowMs)) throw new Error("Response window expired");
  r.state = "accepted";
  r.respondedAt = new Date(nowMs).toISOString();
  return { already: false };
};

const declineResponse = (state, guardianId, nowMs = Date.now()) => {
  const r = state.responses[guardianId];
  if (!r) throw new Error("Unknown guardian response");
  if (r.state === "declined") return { already: true };
  if (r.state === "accepted") throw new Error("Response already accepted");
  if (isExpired(r, nowMs)) throw new Error("Response window expired");
  r.state = "declined";
  r.respondedAt = new Date(nowMs).toISOString();
  return { already: false };
};

// A guardian's live pin during an accepted response. Accepted-only:
// a merely-notified guardian has not consented to share location
// with the victim yet.
const recordGuardianAlertLocation = (state, guardianId, lat, lng, nowMs = Date.now()) => {
  const r = state.responses[guardianId];
  if (!r) throw new Error("Unknown guardian response");
  if (r.state !== "accepted") throw new Error("Guardian has not accepted this alert");
  if (!isValidLatitude(lat)) throw new Error("Invalid latitude");
  if (!isValidLongitude(lng)) throw new Error("Invalid longitude");
  const pin = { lat: Number(lat), lng: Number(lng), updatedAt: new Date(nowMs).toISOString() };
  state.locations[guardianId] = pin;
  return pin;
};

// One preset message. The sender's role decides the allowlist: a
// victim cannot send a guardian line and vice versa, and a guardian
// must be an accepted responder. Text is rendered from the key here
// — never from client input.
const addMessage = (state, { sender, guardianId, key, nowMs = Date.now() } = {}) => {
  let role;
  let from;
  if (sender === "victim") {
    role = "victim";
    from = "victim";
  } else if (sender === "guardian") {
    const r = state.responses[guardianId];
    if (!r) throw new Error("Unknown guardian response");
    if (r.state !== "accepted") throw new Error("Guardian has not accepted this alert");
    role = "guardian";
    from = guardianId;
  } else {
    throw new Error("Unknown sender");
  }
  const text = PRESET_MESSAGES[role][key];
  if (typeof text !== "string") throw new Error("Unknown message");
  const message = { from, key, text, at: new Date(nowMs).toISOString() };
  state.messages.push(message);
  while (state.messages.length > MAX_MESSAGES) state.messages.shift();
  return message;
};

// The victim's read: responses in notify order, accepted guardians'
// live pins with distance from the victim, messages with the
// guardian sender's name attached. A merely-notified guardian
// contributes no coordinates — there is nothing to show for them.
const guardianAlertSummary = (state, { lat, lng } = {}) => {
  const empty = { notified: 0, accepted: 0, responses: [], locations: [], messages: [] };
  if (!state || typeof state !== "object") return empty;
  const responses = Object.values(state.responses || {});
  const locations = [];
  for (const r of responses) {
    if (r.state !== "accepted") continue;
    const pin = state.locations && state.locations[r.guardianId];
    if (!pin) continue;
    locations.push({
      guardianId: r.guardianId,
      name: r.name,
      lat: pin.lat,
      lng: pin.lng,
      distanceKm:
        isValidLatitude(lat) && isValidLongitude(lng)
          ? Math.round(haversineKm(Number(lat), Number(lng), pin.lat, pin.lng) * 10) / 10
          : null,
      updatedAt: pin.updatedAt,
    });
  }
  return {
    notified: responses.length,
    accepted: responses.filter((r) => r.state === "accepted").length,
    responses: responses.map((r) => ({
      guardianId: r.guardianId,
      name: r.name,
      role: r.role,
      state: r.state,
      distanceKm: r.distanceKm,
      score: r.score,
      notifiedAt: r.notifiedAt,
      respondedAt: r.respondedAt,
    })),
    locations,
    messages: (state.messages || []).map((m) => ({
      ...m,
      name: m.from === "victim" ? null : state.responses[m.from]?.name ?? null,
    })),
  };
};

// Notifies the matched guardians for one alert. Idempotent per
// alert: a second call (e.g. a retry-delivered SOS) returns
// already:true and sends nothing. The response is recorded BEFORE
// the SMS is sent, so a failed send still leaves a "matched but not
// reached" record. Sends run in parallel; one bad number cannot
// kill the rest. `sendSmsFn` is the seam tests inject; production
// passes the real sendSms.
const notifyGuardiansForAlert = async ({
  alert,
  lat,
  lng,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = DEFAULT_LIMIT,
  sendSmsFn = ({ to, content }) => sendSms({ to, content }),
  nowMs = Date.now(),
} = {}) => {
  if (!alert || typeof alert !== "object") throw new Error("Invalid alert");
  if (!isValidLatitude(lat)) throw new Error("Invalid latitude");
  if (!isValidLongitude(lng)) throw new Error("Invalid longitude");
  if (alert.guardians && alert.guardians.notifiedAt) {
    return { notified: 0, failed: 0, already: true };
  }
  const state = alert.guardians || newGuardianAlertState();
  alert.guardians = state;
  const candidates = await findNearbyGuardians({ lat, lng, radiusKm, limit, nowMs });
  if (candidates.length === 0) {
    state.notifiedAt = new Date(nowMs).toISOString();
    return { notified: 0, failed: 0, reason: "no-guardians-nearby" };
  }
  const results = await Promise.all(
    candidates.map(async (c) => {
      const guardian = await guardianStore.get(c.id);
      const phone = normalizePhone(guardian && guardian.phone);
      recordNotification(state, {
        guardianId: c.id,
        name: c.name,
        role: c.role,
        distanceKm: c.distanceKm,
        score: c.score,
        nowMs,
      });
      if (!phone) return { sent: 0, failed: 1, reason: "invalid-phone" };
      try {
        return await sendSmsFn({
          to: phone,
          content: `🚨 SafeLife SOS ${c.distanceKm} km away — someone nearby needs help. Open the SafeLife app to accept. Live location: https://maps.google.com/?q=${lat},${lng}`,
        });
      } catch {
        return { sent: 0, failed: 1, reason: "transport-error" };
      }
    })
  );
  state.notifiedAt = new Date(nowMs).toISOString();
  const notified = results.reduce((n, r) => n + (r.sent || 0), 0);
  const failed = results.reduce((n, r) => n + (r.failed || 0), 0);
  const reason =
    candidates.length === 0
      ? "no-guardians-nearby"
      : notified === 0 && failed > 0
        ? results.find((r) => r.reason)?.reason || "sms-failed"
        : undefined;
  return { notified, failed, ...(reason ? { reason } : {}) };
};

module.exports = {
  RESPONSE_WINDOW_MS,
  MAX_MESSAGES,
  PRESET_MESSAGES,
  newGuardianAlertState,
  recordNotification,
  isExpired,
  acceptResponse,
  declineResponse,
  recordGuardianAlertLocation,
  addMessage,
  guardianAlertSummary,
  notifyGuardiansForAlert,
};
