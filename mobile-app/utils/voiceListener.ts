// D28 wake-word listener — feeds speech transcripts into the D25
// "help help" detector (utils/voiceTrigger.ts).
//
// The native recognizer (expo-speech-recognition) only exists in a
// development build — in Expo Go the module is absent, so it is
// loaded lazily and every failure path degrades to an honest status
// instead of a crash. The SOS button and shake trigger never depend
// on this file.
//
// Recognizers stop on silence even in continuous mode, so the
// listener restarts itself on 'end'/'error' while active. stop()
// cancels the pending restart.
//
// shortcut: no background/foreground-service listening — the
// recognizer runs while the SOS tab is mounted. Always-on
// risk-mode listening needs a native foreground service; that is
// D30-build scope, not managed-Expo scope.
import { createVoiceTriggerDetector } from './voiceTrigger';

export type VoiceListenerStatus =
  | 'listening'
  | 'unavailable' // native module missing (Expo Go) or no recognizer
  | 'denied' // mic / speech permission not granted
  | 'stopped';

type SpeechModule = {
  ExpoSpeechRecognitionModule: {
    start: (options: Record<string, unknown>) => void;
    stop: () => void;
    requestPermissionsAsync: () => Promise<{ granted: boolean }>;
    addListener: (
      event: string,
      cb: (payload: never) => void,
    ) => { remove: () => void };
  };
};

type ResultEvent = { results?: { transcript?: string }[] };

const RESTART_DELAY_MS = 800;

function defaultLoadModule(): SpeechModule | null {
  try {
    // Lazy require: a static import would still load in Expo Go but
    // every call would fail; catching here keeps one honest path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-speech-recognition') as SpeechModule;
  } catch {
    return null;
  }
}

export function startVoiceListener(
  opts: {
    onFired: () => void;
    onStatus?: (status: VoiceListenerStatus) => void;
  },
  loadModule: () => SpeechModule | null = defaultLoadModule,
): () => void {
  const detector = createVoiceTriggerDetector();
  let active = true;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  const subscriptions: { remove: () => void }[] = [];

  const stop = () => {
    active = false;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    for (const sub of subscriptions) sub.remove();
    subscriptions.length = 0;
    try {
      loadModule()?.ExpoSpeechRecognitionModule.stop();
    } catch {
      /* already stopped / module gone — nothing to clean */
    }
    opts.onStatus?.('stopped');
  };

  const mod = loadModule();
  if (!mod) {
    opts.onStatus?.('unavailable');
    return stop;
  }
  const recognizer = mod.ExpoSpeechRecognitionModule;

  const start = () => {
    if (!active) return;
    try {
      recognizer.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
      });
      opts.onStatus?.('listening');
    } catch {
      scheduleRestart();
    }
  };

  const scheduleRestart = () => {
    if (!active || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, RESTART_DELAY_MS);
  };

  subscriptions.push(
    recognizer.addListener('result', (event: ResultEvent) => {
      const transcript = event.results?.[0]?.transcript;
      if (!transcript) return;
      if (detector.feed(transcript) === 'fired') opts.onFired();
    }),
    recognizer.addListener('end', () => scheduleRestart()),
    recognizer.addListener('error', () => scheduleRestart()),
  );

  recognizer
    .requestPermissionsAsync()
    .then((permission) => {
      if (!active) return;
      if (!permission.granted) {
        opts.onStatus?.('denied');
        return;
      }
      start();
    })
    .catch(() => {
      if (active) opts.onStatus?.('unavailable');
    });

  return stop;
}
