// Battery thresholds — SINGLE SOURCE OF TRUTH (mobile side).
//
// Mirror: Backend/services/batteryThresholds.js — the backend worker
// owns an identical file with identical values. Change both, in the
// same commit; the server re-checks the kind/level band on receipt,
// this copy only decides when the app attempts a send. (Run-3 F-11.3:
// the 15/5/20 values used to be duplicated in
// mobile-app/utils/batteryAlerts.ts and Backend/services/battery.js,
// free to drift apart.)
export const BATTERY_LOW_THRESHOLD = 15;
export const BATTERY_FINAL_THRESHOLD = 5;
export const BATTERY_REARM_LEVEL = 20;
