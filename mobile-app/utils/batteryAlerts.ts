// Battery-alert firing decision — SafeLife 2.0 Day 11 (plan §6 D11).
//
// Pure, dependency-free so it can be verified outside the app. The
// thresholds and the decide() semantics MIRROR Backend/services/
// battery.js exactly — change both, in the same commit. The server
// re-checks the kind/level band on receipt; this copy only decides
// when the app attempts a send.
//
// The numbers live in constants/batteryThresholds.ts (single source
// of truth, mirrored by Backend/services/batteryThresholds.js) —
// this file re-exports them so existing import sites keep working.
//
// Rules (same as the server): charging never warns; while an alert
// is active only the 5% final burst fires (a "NOT an SOS" low
// warning mid-emergency would confuse contacts); otherwise 15%
// warns once per discharge cycle until the level climbs above
// REARM_LEVEL (a recharge), which re-arms the warning.
import {
  BATTERY_LOW_THRESHOLD,
  BATTERY_FINAL_THRESHOLD,
  BATTERY_REARM_LEVEL,
} from '../constants/batteryThresholds';

export { BATTERY_LOW_THRESHOLD, BATTERY_FINAL_THRESHOLD, BATTERY_REARM_LEVEL };

export type BatteryAlertKind = 'low' | 'final';

export function decideBatteryAlert(input: {
  level: number;
  /** true = plugged in, false = discharging, null = OS cannot say. */
  charging: boolean | null;
  alertActive: boolean;
  lowSent: boolean;
  finalSent: boolean;
}): BatteryAlertKind | null {
  const { level, charging, alertActive, lowSent, finalSent } = input;
  if (!Number.isFinite(level) || level < 0 || level > 100) return null;
  if (charging === true) return null;
  if (alertActive) {
    return level <= BATTERY_FINAL_THRESHOLD && !finalSent ? 'final' : null;
  }
  return level <= BATTERY_LOW_THRESHOLD && !lowSent ? 'low' : null;
}

// Queued battery-alert payload (F-M1) — the minimal copy of a live
// battery-alert POST that the retry path (flushPendingBatteryAlert)
// actually needs, shrunk so it always fits SecureStore's 2048-byte
// Android cap. The live send goes out untruncated; only the queued
// copy is shrunk, because the server applies these exact caps on
// receipt anyway (Backend/routes/alerts.js POST /battery-alert):
// contact name sanitizeText(…, 60), user name sanitizeText(…, 100),
// user phone sanitizeText(…, 30), contacts sliced to 10. Contact
// phones are cut to 20 chars: a valid E.164 number is at most 16
// chars, so anything longer is unparseable and the server drops it
// via normalizePhone — truncating it loses nothing deliverable.
// Fields kept are exactly what the retry path reads or re-sends:
// kind + alertId (freshness checks), lat/lng/battery (re-sent, and
// refreshed from live refs when a fix exists), name/phone/contacts
// (the alert itself). NO pushToken: the stored emergency-contacts
// cache carries name + phone only (contacts.tsx saves {name, phone}),
// so a pushToken here would always be absent — the server maps a
// missing pushToken to '' and drops the contact only if name + phone
// are empty too. Adding the field (up to 1024 chars per contact
// server-side) would buy nothing and could blow the cap on its own.
// Worst case after shrinking: 10 contacts × ~96 B + ~190 B of
// scalars/wrapper ≈ 1.2 kB < 2048 B (see scripts/
// check-battery-queue-size.mjs). Never fall back to plaintext
// AsyncStorage: if this ever did exceed the cap, secureSetItem
// still drops it rather than storing it in the clear.
export function buildQueuedBatteryAlertPayload(input: {
  kind: BatteryAlertKind;
  lat: string;
  lng: string;
  name: string;
  phone: string;
  battery: number;
  contacts: { name: string; phone: string }[];
  alertId?: string;
}): Record<string, unknown> {
  return {
    kind: input.kind,
    lat: input.lat,
    lng: input.lng,
    name: input.name.slice(0, 100),
    phone: input.phone.slice(0, 30),
    battery: input.battery,
    contacts: input.contacts.slice(0, 10).map((c) => ({
      name: c.name.slice(0, 60),
      phone: c.phone.slice(0, 20),
    })),
    ...(input.alertId ? { alertId: input.alertId } : {}),
  };
}
