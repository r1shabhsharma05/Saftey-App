// D26 stealth recording — audio half (plan §6 D26, §3 F5).
//
// expo-audio (SDK 58, ships in Expo Go — no development build
// needed, unlike D25's speech recognizer). The recorder comes from
// the useAudioRecorder hook (the class is type-only at the package
// entry — there is no public constructor), so this is a component:
// it records 5 s segments in a loop while mounted and hands each
// finished file to the chunk queue; the queue owns upload + resume.
//
// Stealth means: no preview, no sound, no in-app indication beyond
// the alert screen itself. It does NOT mean invisible to the OS —
// Android/iOS still show their mic indicator while recording, and
// nothing in managed Expo can hide that.
//
// A denied mic means no audio half — the caller mounts this only
// while an alert is live, and the video half + the SOS proceed
// regardless. A failed segment (permission revoked mid-alert,
// recorder error) waits a second and retries; the loop must never
// kill the SOS it serves.
import { useEffect, useRef } from 'react';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { EVIDENCE_CHUNK_MS, type EvidenceKind } from '../utils/evidenceChunks';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function StealthAudioRecorder({ onChunk }: { onChunk: (kind: EvidenceKind, uri: string) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;
  const wakeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
      if (!perm || perm.status !== 'granted') return;
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
      while (!cancelled) {
        try {
          const rec = recorderRef.current;
          await rec.prepareToRecordAsync();
          if (cancelled) return;
          rec.record();
          // Interruptible sleep: unmount wakes it so the in-flight
          // segment is stopped and emitted at once, not after a
          // full 5 s window.
          await new Promise<void>((resolve) => {
            wakeRef.current = resolve;
            setTimeout(() => {
              wakeRef.current = null;
              resolve();
            }, EVIDENCE_CHUNK_MS);
          });
          await rec.stop().catch(() => {});
          const uri = rec.uri;
          if (uri) onChunkRef.current('audio', uri);
          if (cancelled) return;
        } catch {
          if (cancelled) return;
          await sleep(1000);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      wakeRef.current?.();
      wakeRef.current = null;
    };
    // Mount/unmount is the lifecycle: the SOS tab mounts this only
    // while an alert with an id is live (see index.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
