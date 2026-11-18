// D27 test: Evidence Vault client (utils/evidenceVault.ts).
//
// No test runner is installed in mobile-app, so this script compiles
// the real utils/evidenceVault.ts with the project's TypeScript into
// a temp dir and asserts against the compiled output (no logic is
// duplicated here). The util takes auth headers as a parameter and
// imports nothing from the app graph, so it compiles standalone;
// fetch is stubbed per test.
// Run: `npm test` (or `node scripts/check-evidence-vault.mjs`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'safelife-evidence-vault-'));
try {
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), [
    'utils/evidenceVault.ts',
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--skipLibCheck',
  ], { cwd: root, stdio: 'pipe' });
  const { fetchVault, fetchVaultProof, shortHash } = await import(join(out, 'evidenceVault.js'));

  // Short hashes are display-only — the full hash lives in the proof.
  assert.equal(shortHash('9f2c41aa08d7e5f1'), '9f2c41aa08d7…');
  assert.equal(shortHash(null), '—');

  const vaultBody = {
    success: true,
    vault: {
      alertId: 'alert-1',
      ok: true,
      verified: true,
      reason: null,
      chunks: [
        { kind: 'audio', index: 0, storagePath: 'alert-1/audio-0000.m4a', bytes: 42000, mime: 'audio/mp4', uploadedAt: '2026-11-19T00:00:00.000Z', sha256: 'aa', chainHash: 'bb', verified: true },
      ],
      rootHash: 'bb',
      missing: [],
      verifiedAt: '2026-11-19T00:01:00.000Z',
    },
  };

  // Happy path: the vault parses, the URL carries the alert id.
  let seenUrl = '';
  globalThis.fetch = async (url) => {
    seenUrl = String(url);
    return { ok: true, json: async () => vaultBody };
  };
  const vault = await fetchVault('https://backend.example', 'alert-1', { Authorization: 'Bearer x' });
  assert.equal(vault?.verified, true);
  assert.equal(vault?.rootHash, 'bb');
  assert.equal(vault?.chunks[0].sha256, 'aa');
  assert.ok(seenUrl.includes('/alert/alert-1/evidence/vault'));

  // Export parses the proof.
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ success: true, proof: { ...vaultBody.vault, version: 1, exportedAt: '2026-11-19T00:02:00.000Z' } }),
  });
  const proof = await fetchVaultProof('https://backend.example', 'alert-1', {});
  assert.equal(proof?.version, 1);
  assert.equal(proof?.rootHash, 'bb');

  // Non-OK is unavailable (null) — never shown as verified.
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await fetchVault('https://backend.example', 'alert-1', {}), null);
  assert.equal(await fetchVaultProof('https://backend.example', 'alert-1', {}), null);

  // Network error is unavailable too.
  globalThis.fetch = async () => { throw new Error('down'); };
  assert.equal(await fetchVault('https://backend.example', 'alert-1', {}), null);

  // A 200 without success:true is not a vault.
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: false }) });
  assert.equal(await fetchVault('https://backend.example', 'alert-1', {}), null);

  console.log('evidence-vault checks: green');
} finally {
  rmSync(out, { recursive: true, force: true });
}
