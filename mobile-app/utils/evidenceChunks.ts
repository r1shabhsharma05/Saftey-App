// D26 stealth recording — chunked live upload (plan §6 D26, §3 F5).
//
// Pure TS, zero imports: the naming, sequencing and resume maths for
// 5-second evidence chunks. The recorders (components/
// StealthAudioRecorder.tsx, components/StealthCamera.tsx) cut the
// (utils/evidenceQueue.ts) uploads them; the backend registry
// (Backend/routes/evidence.js) records what landed. D27's Evidence
// Vault hash-chains the registered chunks — this file deliberately
// carries no hash: no hash is computed until bytes exist to hash.
//
// Design (why chunks, why 5 s): if the phone is snatched or dies
// mid-alert (plan scenario S4), only the in-flight segment is lost —
// everything before it is already in the cloud. 5 s bounds the loss
// without drowning the uploader in requests (12/min per stream).
// Audio (.m4a, expo-audio) and video (.mp4/.mov, expo-camera) are
// separate streams with separate indexes, paired by D27 on
// alertId + index + uploadedAt.
export const EVIDENCE_CHUNK_MS = 5000;
export const EVIDENCE_BUCKET = 'evidence';
// A 5 s 720p video segment is ~1–2 MB; 25 MB is a hard sanity cap,
// not a target — anything over it is dropped, never retried forever.
export const EVIDENCE_MAX_CHUNK_BYTES = 25 * 1024 * 1024;
// Same table as the D5 SOS outbox (index.tsx QUEUE_BACKOFF_MS):
// 30 s → 2 m → 5 m → 15 m, capped. A failed chunk must not hammer
// a flaky link, and a flush is only meaningful when connectivity
// has returned.
export const EVIDENCE_QUEUE_BACKOFF_MS = [30000, 120000, 300000, 900000];

export type EvidenceKind = 'audio' | 'video';

export interface EvidenceChunk {
  alertId: string;
  kind: EvidenceKind;
  index: number;
  storagePath: string;
  // Local cache URI of the recorded segment. Kept until the upload
  // + registry both succeed — the queue, not the recorder, owns it.
  uri: string;
  attempts: number;
  nextRetryAt: number;
  createdAt: number;
}

const pad = (index: number) => String(index).padStart(4, '0');

// The extension comes from the recorded file itself: expo-audio
// writes .m4a; expo-camera writes .mp4 (Android) or .mov (iOS).
// An unknown extension never invents one — the chunk keeps the
// recorder's suffix so the vault can play it back as recorded.
export function chunkFileName(kind: EvidenceKind, index: number, uri: string): string {
  const ext = kind === 'audio' ? 'm4a' : uri.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  return `${kind}-${pad(index)}.${ext}`;
}

export function evidenceStoragePath(alertId: string, kind: EvidenceKind, index: number, uri: string): string {
  return `${alertId}/${chunkFileName(kind, index, uri)}`;
}

// Next index for a kind: one past the highest already queued or
// registered — a restart mid-alert resumes the sequence instead of
// overwriting chunk 0000.
export function nextChunkIndex(chunks: Array<{ kind: EvidenceKind; index: number }>, kind: EvidenceKind): number {
  let max = -1;
  for (const c of chunks) if (c.kind === kind && c.index > max) max = c.index;
  return max + 1;
}

// Chunks whose backoff has expired, oldest first — the flush order.
export function pendingChunks(chunks: EvidenceChunk[], now: number): EvidenceChunk[] {
  return chunks.filter((c) => now >= c.nextRetryAt).sort((a, b) => a.createdAt - b.createdAt);
}

// Backoff after a failed attempt (attempts counts failures so far).
export function chunkBackoffMs(attempts: number): number {
  return EVIDENCE_QUEUE_BACKOFF_MS[Math.min(Math.max(attempts - 1, 0), EVIDENCE_QUEUE_BACKOFF_MS.length - 1)];
}

// Server-side shape check, shared by the app (never upload a path
// outside the alert's folder) and the backend registry (never accept
// one): <alertId>/<kind>-NNNN.(m4a|mp4|mov), no traversal, no nesting.
export function isValidEvidencePath(path: string, alertId: string, kind: EvidenceKind, index: number): boolean {
  if (typeof path !== 'string' || typeof alertId !== 'string' || !alertId) return false;
  if (!/^[A-Za-z0-9-]+$/.test(alertId)) return false;
  const ext = kind === 'audio' ? 'm4a' : '(mp4|mov)';
  return new RegExp(`^${alertId}/${kind}-${pad(index)}\\.(?:${ext})$`).test(path);
}
