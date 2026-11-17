// D28 test: the shake trigger detector (utils/shakeTrigger.ts).
//
// No test runner is installed in mobile-app, so this script compiles
// the real utils/shakeTrigger.ts with the project's TypeScript into
// a temp dir and asserts against the compiled output (no logic is
// duplicated here).
// Run: `npm test` (or `node scripts/check-shake-trigger.mjs`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'safelife-shake-trigger-'));
try {
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), [
    'utils/shakeTrigger.ts',
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--skipLibCheck',
  ], { cwd: root, stdio: 'pipe' });
  // Single-file compile: tsc's common root is utils/ itself, so the
  // output lands at out/shakeTrigger.js, not out/utils/shakeTrigger.js.
  const { createShakeDetector } = await import(join(out, 'shakeTrigger.js'));

  // Fake clock + helpers: rest is (0, 0, 1) — gravity only, ~1g.
  let now = 1000000;
  const clock = () => now;
  const rest = (d) => d.feed(0, 0, 1);
  const spike = (d) => d.feed(0, 0, 3);

  // Rest never fires, however long.
  const d1 = createShakeDetector(clock);
  for (let i = 0; i < 50; i++) {
    now += 100;
    assert.equal(rest(d1), false);
  }

  // Three sharp shakes inside the window fire on the third.
  const d2 = createShakeDetector(clock);
  assert.equal(spike(d2), false);
  now += 200;
  assert.equal(spike(d2), false);
  now += 200;
  assert.equal(spike(d2), true);

  // Two shakes only never fire.
  const d3 = createShakeDetector(clock);
  assert.equal(spike(d3), false);
  now += 200;
  assert.equal(spike(d3), false);

  // Peaks spread past the 2.5 s window never combine: 1 + 1 + 1
  // spaced 3 s apart is three separate non-events.
  const d4 = createShakeDetector(clock);
  assert.equal(spike(d4), false);
  now += 3000;
  assert.equal(spike(d4), false);
  now += 3000;
  assert.equal(spike(d4), false);

  // One shake sampled rapidly (100 ms cadence) counts once: the
  // samples inside the 120 ms gap are the same peak, not new ones.
  const d5 = createShakeDetector(clock);
  assert.equal(spike(d5), false);
  now += 100;
  assert.equal(spike(d5), false);
  now += 100;
  assert.equal(spike(d5), false);
  now += 200;
  assert.equal(spike(d5), true);

  // Cooldown: after firing, more shaking does nothing for 60 s.
  const d6 = createShakeDetector(clock);
  assert.equal(spike(d6), false);
  now += 200;
  assert.equal(spike(d6), false);
  now += 200;
  assert.equal(spike(d6), true);
  now += 200;
  assert.equal(spike(d6), false);
  now += 61000;
  assert.equal(spike(d6), false);
  now += 200;
  assert.equal(spike(d6), false);
  now += 200;
  assert.equal(spike(d6), true);

  // reset() clears peaks and cooldown.
  const d7 = createShakeDetector(clock);
  assert.equal(spike(d7), false);
  d7.reset();
  assert.equal(spike(d7), false);
  now += 200;
  assert.equal(spike(d7), false);
  now += 200;
  assert.equal(spike(d7), true);

  console.log('ok — shake trigger: 3 sharp shakes fire, rest / 2 shakes / slow shakes never fire');
} finally {
  rmSync(out, { recursive: true, force: true });
}
