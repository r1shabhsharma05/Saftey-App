// D26 stealth recording — chunked live upload + resume-on-reconnect
// (plan §6 D26, §3 F5; S4: the phone may die mid-alert, so every
// finished 5 s segment leaves the phone as soon as it exists).
//
// Pipeline per chunk: record → enqueue (durable, secure storage)
// → upload to the private Supabase Storage `evidence` bucket (same
// direct-upload pattern as the avatar flow in explore.tsx — the
// backend never sees the bytes, Vercel cannot hold them) → register
// in the backend chunk registry (POST /alert/:id/evidence/chunks,
// idempotent, so a retried register never duplicates). A chunk
// leaves the queue only when BOTH succeed; anything else backs off
// (D5's table) and retries on the next flush — NetInfo reconnect,
// foreground, or the next finished chunk.
//
// Not yet live, honestly: the `evidence` bucket does not exist until
// Rishabh creates it (SQL in the Day-26 report). Until then every
// upload fails cleanly, every chunk stays queued, and nothing is
// lost or faked as uploaded — the resume half is the working half
// until the bucket lands.
//
// Indexes survive restarts: a per-alert counter in secure storage
// (not just the queue — an emptied queue would restart at 0 and
// collide with already-registered chunks). upsert:false on the
// upload means a re-attempt never overwrites evidence.
import { supabase } from './supabase';
import { secureGetItem, secureSetItem } from './secureStorage';
import { getAuthHeaders } from './apiAuth';
import {
  EVIDENCE_BUCKET,
  EVIDENCE_MAX_CHUNK_BYTES,
  chunkBackoffMs,
  evidenceStoragePath,
  nextChunkIndex,
  pendingChunks,
  type EvidenceChunk,
  type EvidenceKind,
} from './evidenceChunks';

const QUEUE_KEY = 'pendingEvidenceChunks';
const counterKey = (alertId: string, kind: EvidenceKind) => `evidenceCounter:${alertId}:${kind}`;

const loadQueue = async (): Promise<EvidenceChunk[]> => {
  try {
    const raw = await secureGetItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveQueue = (queue: EvidenceChunk[]) => secureSetItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => {});

export async function enqueueEvidenceChunk(
  alertId: string,
  kind: EvidenceKind,
  uri: string
): Promise<EvidenceChunk | null> {
  try {
    const queue = await loadQueue();
    const rawCounter = await secureGetItem(counterKey(alertId, kind)).catch(() => null);
    const counter = rawCounter ? parseInt(rawCounter, 10) : 0;
    const index = Math.max(
      nextChunkIndex(
        queue.filter((c) => c.alertId === alertId),
        kind
      ),
      Number.isFinite(counter) ? counter : 0
    );
    const chunk: EvidenceChunk = {
      alertId,
      kind,
      index,
      storagePath: evidenceStoragePath(alertId, kind, index, uri),
      uri,
      attempts: 0,
      nextRetryAt: 0,
      createdAt: Date.now(),
    };
    await secureSetItem(counterKey(alertId, kind), String(index + 1)).catch(() => {});
    queue.push(chunk);
    await saveQueue(queue);
    return chunk;
  } catch {
    return null;
  }
}

const mimeFor = (kind: EvidenceKind, uri: string) =>
  kind === 'audio' ? 'audio/mp4' : uri.toLowerCase().endsWith('.mov') ? 'video/quicktime' : 'video/mp4';

let flushInFlight = false;

// Uploads every due chunk. Returns counts; a failed chunk stays
// queued with backoff — the caller decides when to flush again.
export async function flushEvidenceQueue(
  backendUrl: string
): Promise<{ uploaded: number; failed: number; pending: number }> {
  if (flushInFlight) return { uploaded: 0, failed: 0, pending: 0 };
  flushInFlight = true;
  try {
    const queue = await loadQueue();
    const now = Date.now();
    const due = pendingChunks(queue, now);
    let uploaded = 0;
    let failed = 0;
    const remaining = [...queue];
    for (const chunk of due) {
      const fail = () => {
        failed += 1;
        const attempts = chunk.attempts + 1;
        Object.assign(chunk, { attempts, nextRetryAt: now + chunkBackoffMs(attempts) });
      };
      try {
        const arrayBuffer = await (await fetch(chunk.uri)).arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        // Oversize is not retryable — drop it rather than looping
        // on a segment that can never land.
        if (bytes.byteLength === 0 || bytes.byteLength > EVIDENCE_MAX_CHUNK_BYTES) {
          remaining.splice(remaining.indexOf(chunk), 1);
          failed += 1;
          continue;
        }
        const { error: uploadError } = await supabase.storage
          .from(EVIDENCE_BUCKET)
          .upload(chunk.storagePath, arrayBuffer, { contentType: mimeFor(chunk.kind, chunk.uri), upsert: false });
        // "Already exists" means the bytes landed on an earlier
        // attempt whose registry POST never completed — proceed to
        // the idempotent register instead of failing the chunk.
        const alreadyThere = !!uploadError && uploadError.message.toLowerCase().includes('already exists');
        if (uploadError && !alreadyThere) {
          fail();
          continue;
        }
        const res = await fetch(`${backendUrl}/alert/${chunk.alertId}/evidence/chunks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await getAuthHeaders()) },
          body: JSON.stringify({
            kind: chunk.kind,
            index: chunk.index,
            storagePath: chunk.storagePath,
            bytes: bytes.byteLength,
            mime: mimeFor(chunk.kind, chunk.uri),
          }),
        }).catch(() => null);
        if (!res || !res.ok) {
          fail();
          continue;
        }
        remaining.splice(remaining.indexOf(chunk), 1);
        uploaded += 1;
      } catch {
        fail();
      }
    }
    await saveQueue(remaining);
    return { uploaded, failed, pending: remaining.length };
  } finally {
    flushInFlight = false;
  }
}
