// D28 shake trigger — swapped into D25 per amendment A7 (the D25
// wake-word listener needs a development build, frozen until the
// Day-30 release, so the alternate triggers go first).
//
// Pure TS, zero imports: the detector a raw accelerometer feed
// (expo-sensors, 100 ms samples, g units) runs through. Three sharp
// shakes inside the window fire one SOS; anything weaker is ignored.
//
// Tuning (false positives are the risk — a phone in a pocket on a
// bumpy bus must not SOS): at rest the magnitude sits near 1g
// (gravity), so the threshold is 2.2g total — a deliberate shake
// spikes well past it, walking and vehicle vibration do not. Peaks
// closer than SHAKE_MIN_PEAK_GAP_MS are one shake, not two. After
// firing, a cooldown blocks a second SOS from the same shaking.
export const SHAKE_THRESHOLD_G = 2.2;
export const SHAKE_PEAKS_TO_FIRE = 3;
export const SHAKE_WINDOW_MS = 2500;
export const SHAKE_MIN_PEAK_GAP_MS = 120;
export const SHAKE_COOLDOWN_MS = 60000;

export function createShakeDetector(now: () => number = Date.now) {
  let peaks: number[] = [];
  let lastPeakAt = 0;
  let cooldownUntil = 0;

  return {
    // Returns true exactly when the third qualifying peak lands.
    feed(x: number, y: number, z: number): boolean {
      const at = now();
      if (at < cooldownUntil) return false;
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude < SHAKE_THRESHOLD_G) return false;
      if (at - lastPeakAt < SHAKE_MIN_PEAK_GAP_MS) return false;
      lastPeakAt = at;
      peaks = peaks.filter((p) => at - p <= SHAKE_WINDOW_MS);
      peaks.push(at);
      if (peaks.length >= SHAKE_PEAKS_TO_FIRE) {
        peaks = [];
        cooldownUntil = at + SHAKE_COOLDOWN_MS;
        return true;
      }
      return false;
    },
    reset() {
      peaks = [];
      lastPeakAt = 0;
      cooldownUntil = 0;
    },
  };
}
