// D25 wake-word engine — "help help" detector (plan §6 D25, F5).
//
// Pure TS, zero imports: the matcher + state machine a speech
// recognizer feeds transcripts into. Feed every (partial or final)
// transcript; the detector decides armed / fired / ignored.
//
// False-positive tuning (the whole point of D25):
// - Word-boundary match only: "helpful", "helping", "helped" never
//   count — only the standalone word "help".
// - One "help" only ARMS. A single "help me" / "can you help me"
//   never fires an SOS; it needs a second "help" inside the window.
// - The arm expires after VOICE_TRIGGER_WINDOW_MS; a lone "help"
//   from a minute ago cannot combine with a new one.
// - After firing, a cooldown blocks a second SOS from the same
//   outburst (the 10-second cancel window + D23 strikes are the
//   backstop for anything that still slips through).
//
// D28: the live listener now ships (utils/voiceListener.ts,
// expo-speech-recognition + config plugin). It still only *runs*
// in a development/release build — in Expo Go the native module is
// absent and the listener reports 'unavailable' honestly. The
// Day-30 release build is the first build that can hear "help help".
export type SosTriggerSource = 'button' | 'voice' | 'shake' | 'duress';

// Two "help"s must land inside this window to fire.
export const VOICE_TRIGGER_WINDOW_MS = 4000;
// After firing, the same outburst cannot fire a second SOS.
export const VOICE_TRIGGER_COOLDOWN_MS = 60000;

// Standalone "help" words in a transcript — punctuation and case
// insensitive, word-boundary only ("helpful" scores 0).
export function countHelpWords(transcript: string): number {
  return transcript
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token === 'help').length;
}

export type VoiceTriggerEvent = 'armed' | 'fired' | 'ignored';

export function createVoiceTriggerDetector(now: () => number = Date.now) {
  let armedAt: number | null = null;
  let cooldownUntil = 0;

  return {
    feed(transcript: string): VoiceTriggerEvent {
      const at = now();
      if (at < cooldownUntil) return 'ignored';
      const helps = countHelpWords(transcript);
      if (helps === 0) {
        // Silence (or chatter) past the window disarms a stale arm.
        if (armedAt !== null && at - armedAt > VOICE_TRIGGER_WINDOW_MS) armedAt = null;
        return 'ignored';
      }
      // "help help" in one transcript fires at once.
      if (helps >= 2) {
        armedAt = null;
        cooldownUntil = at + VOICE_TRIGGER_COOLDOWN_MS;
        return 'fired';
      }
      // Exactly one "help": fire only if the previous one is still
      // inside the window, else (re-)arm on this one.
      if (armedAt !== null && at - armedAt <= VOICE_TRIGGER_WINDOW_MS) {
        armedAt = null;
        cooldownUntil = at + VOICE_TRIGGER_COOLDOWN_MS;
        return 'fired';
      }
      armedAt = at;
      return 'armed';
    },
    reset() {
      armedAt = null;
      cooldownUntil = 0;
    },
  };
}
