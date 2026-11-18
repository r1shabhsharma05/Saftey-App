// D26 test: stealth-recording chunk maths (utils/evidenceChunks.ts).
//
// No test runner is installed in mobile-app, so this script compiles
// the real utils/evidenceChunks.ts with the project's TypeScript into
// a temp dir and asserts against the compiled output (no logic is
// duplicated here).
// Run: `npm test` (or `node scripts/check-evidence-chunks.mjs`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'safelife-evidence-chunks-'));
try {
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), [
    'utils/evidenceChunks.ts',
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--skipLibCheck',
  ], { cwd: root, stdio: 'pipe' });
  const {
    EVIDENCE_CHUNK_MS,
    chunkFileName,
    evidenceStoragePath,
    nextChunkIndex,
    pendingChunks,
    chunkBackoffMs,
    isValidEvidencePath,
  } = await import(join(out, 'evidenceChunks.js'));

  // 5 s segments — the S4 loss bound.
  assert.equal(EVIDENCE_CHUNK_MS, 5000);

  // Naming: audio is .m4a, video follows the recorded file (.mp4
  // Android, .mov iOS), zero-padded indexes, per-alert folders.
  assert.equal(chunkFileName('audio', 0, 'file:///x/rec.m4a'), 'audio-0000.m4a');
  assert.equal(chunkFileName('audio', 12, 'file:///x/rec.m4a'), 'audio-0012.m4a');
  assert.equal(chunkFileName('video', 3, 'file:///x/v.mp4'), 'video-0003.mp4');
  assert.equal(chunkFileName('video', 3, 'file:///x/v.MOV'), 'video-0003.mov');
  assert.equal(evidenceStoragePath('alert-1', 'video', 1, 'file:///x/v.mp4'), 'alert-1/video-0001.mp4');

  // Next index is per kind and survives restarts (one past the max).
  assert.equal(nextChunkIndex([], 'audio'), 0);
  assert.equal(nextChunkIndex([{ kind: 'video', index: 4 }], 'audio'), 0);
  assert.equal(nextChunkIndex([{ kind: 'audio', index: 0 }, { kind: 'audio', index: 2 }], 'audio'), 3);
  assert.equal(nextChunkIndex([{ kind: 'audio', index: 7 }, { kind: 'video', index: 1 }], 'video'), 2);

  // Pending = backoff expired, oldest first.
  const now = 1000000;
  const chunks = [
    { kind: 'audio', index: 1, nextRetryAt: 0, createdAt: 300 },
    { kind: 'audio', index: 0, nextRetryAt: 0, createdAt: 100 },
    { kind: 'video', index: 0, nextRetryAt: now + 60000, createdAt: 200 },
  ];
  assert.deepEqual(pendingChunks(chunks, now).map((c) => c.index), [0, 1]);

  // Backoff: 30 s → 2 m → 5 m → 15 m, capped.
  assert.equal(chunkBackoffMs(1), 30000);
  assert.equal(chunkBackoffMs(2), 120000);
  assert.equal(chunkBackoffMs(3), 300000);
  assert.equal(chunkBackoffMs(4), 900000);
  assert.equal(chunkBackoffMs(99), 900000);

  // Path validation: exact match only — traversal and cross-alert
  // paths never pass, wrong kind/index/extension never pass.
  assert.equal(isValidEvidencePath('alert-1/audio-0000.m4a', 'alert-1', 'audio', 0), true);
  assert.equal(isValidEvidencePath('alert-1/video-0003.mov', 'alert-1', 'video', 3), true);
  assert.equal(isValidEvidencePath('alert-1/video-0003.mp4', 'alert-1', 'video', 3), true);
  assert.equal(isValidEvidencePath('alert-1/audio-0001.m4a', 'alert-1', 'audio', 0), false);
  assert.equal(isValidEvidencePath('alert-1/video-0003.m4a', 'alert-1', 'video', 3), false);
  assert.equal(isValidEvidencePath('alert-2/audio-0000.m4a', 'alert-1', 'audio', 0), false);
  assert.equal(isValidEvidencePath('../alert-1/audio-0000.m4a', 'alert-1', 'audio', 0), false);
  assert.equal(isValidEvidencePath('alert-1/audio-0000.m4a/extra', 'alert-1', 'audio', 0), false);
  assert.equal(isValidEvidencePath('alert-1/audio-0000.m4a', '', 'audio', 0), false);

  console.log('ok — evidence chunks: 5 s naming, per-kind resume indexes, backoff, path validation');
} finally {
  rmSync(out, { recursive: true, force: true });
}
