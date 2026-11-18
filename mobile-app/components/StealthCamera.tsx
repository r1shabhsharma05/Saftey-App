// D26 stealth recording — video half (plan §6 D26, §3 F5).
//
// expo-camera (SDK 58, ships in Expo Go). A 1×1, opacity-0
// CameraView — laid out so the camera can record, invisible so
// there is no in-app preview — records muted 5 s segments in a loop
// while mounted and hands each file to the chunk queue. The back
// camera films the scene, not the user.
//
// Video is MUTED on purpose: the separate expo-audio track
// (components/StealthAudioRecorder.tsx) is the audio evidence, and two live
// audio recorders contend on Android. If the camera is denied the
// audio half still records; if the mic is denied the video is
// silent but still evidence. Neither failure touches the SOS.
//
// Same stealth caveat as the audio half: the OS camera indicator
// still shows — managed Expo cannot hide it, and the app never
// claims otherwise.
import { useEffect, useRef } from 'react';
import { Camera, CameraView } from 'expo-camera';
import { EVIDENCE_CHUNK_MS, type EvidenceKind } from '../utils/evidenceChunks';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function StealthCamera({ onChunk }: { onChunk: (kind: EvidenceKind, uri: string) => void }) {
  const ref = useRef<CameraView>(null);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const perm = await Camera.requestCameraPermissionsAsync().catch(() => null);
      if (!perm || perm.status !== 'granted') return;
      // recordAsync resolves only when the segment ends (maxDuration
      // or stopRecording), so the loop is one segment at a time with
      // no overlap. A failed segment waits a second and retries —
      // the recording must survive a transient camera error.
      while (!cancelled) {
        if (!ref.current) {
          await sleep(500);
          continue;
        }
        try {
          const video = await ref.current.recordAsync({
            maxDuration: EVIDENCE_CHUNK_MS / 1000,
          });
          if (cancelled) return;
          if (video?.uri) onChunkRef.current('video', video.uri);
        } catch {
          if (cancelled) return;
          await sleep(1000);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
      try {
        ref.current?.stopRecording();
      } catch {
        /* already stopped */
      }
    };
    // Mount/unmount is the lifecycle: the SOS tab mounts this only
    // while an alert is live (see index.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <CameraView ref={ref} mode="video" facing="back" mute style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} />;
}
