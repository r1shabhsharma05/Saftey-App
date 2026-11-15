// 🔋 Battery thresholds — SINGLE SOURCE OF TRUTH (server side).
//
// Run-3 fix round 2 (11.3): these values were duplicated in
// Backend/services/battery.js and mobile-app/utils/batteryAlerts.ts
// and could drift. The server values live HERE now; battery.js
// imports them and re-exports the old names. The app mirror is
// mobile-app/constants/batteryThresholds.ts — it MUST carry the
// identical values (LOW=15, FINAL=5, REARM=20). Change both files
// in the same commit, and keep the numbers equal.
//
//   LOW   — 15%: warn contacts with the last location (not an SOS).
//   FINAL —  5%: during an active alert, one final location burst.
//   REARM — 20%: above this a discharge cycle is over; the app
//           clears its already-sent flag so a later drain warns again.
const LOW = 15;
const FINAL = 5;
const REARM = 20;

module.exports = { LOW, FINAL, REARM };
