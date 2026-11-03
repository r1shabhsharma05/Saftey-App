// Battery-alert firing decision — SafeLife 2.0 Day 11 (plan §6 D11).
//
// Pure, dependency-free so it can be verified outside the app. The
// thresholds and the decide() semantics MIRROR Backend/services/
// battery.js exactly — change both, in the same commit. The server
// re-checks the kind/level band on receipt; this copy only decides
// when the app attempts a send.
//
// Rules (same as the server): charging never warns; while an alert
// is active only the 5% final burst fires (a "NOT an SOS" low
// warning mid-emergency would confuse contacts); otherwise 15%
// warns once per discharge cycle until the level climbs above
// REARM_LEVEL (a recharge), which re-arms the warning.
export const BATTERY_LOW_THRESHOLD = 15;
export const BATTERY_FINAL_THRESHOLD = 5;
export const BATTERY_REARM_LEVEL = 20;

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
