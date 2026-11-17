// D25 test: the "help help" wake-word detector (utils/voiceTrigger.ts).
//
// No test runner is installed in mobile-app, so this script compiles
// the real utils/voiceTrigger.ts with the project's TypeScript into
// a temp dir and asserts against the compiled output (no logic is
// duplicated here).
// Run: `npm test` (or `node scripts/check-voice-trigger.mjs`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'safelife-voice-trigger-'));
try {
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), [
    'utils/voiceTrigger.ts',
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--skipLibCheck',
  ], { cwd: root, stdio: 'pipe' });
  // Single-file compile: tsc's common root is utils/ itself, so the
  // output lands at out/voiceTrigger.js, not out/utils/voiceTrigger.js.
  const { countHelpWords, createVoiceTriggerDetector } = await import(join(out, 'voiceTrigger.js'));

  // Word-boundary counting: "helpful"/"helping"/"helped" score 0.
  assert.equal(countHelpWords('help help'), 2);
  assert.equal(countHelpWords('Help! Help!'), 2);
  assert.equal(countHelpWords('helpful helping helped'), 0);
  assert.equal(countHelpWords('can you help me with this'), 1);
  assert.equal(countHelpWords('help me'), 1);
  assert.equal(countHelpWords(''), 0);

  // Fake clock: the detector takes its time from here.
  let now = 1000000;
  const clock = () => now;
  const detector = createVoiceTriggerDetector(clock);

  // "help help" in one transcript fires at once.
  assert.equal(detector.feed('help help'), 'fired');
  // Cooldown: the same outburst cannot fire twice.
  assert.equal(detector.feed('help help'), 'ignored');
  // Still cooling down 30 s later.
  now += 30000;
  assert.equal(detector.feed('help help'), 'ignored');
  // Past the 60 s cooldown it fires again.
  now += 31000;
  assert.equal(detector.feed('help help'), 'fired');

  // Two separate "help"s inside the 4 s window fire.
  const d2 = createVoiceTriggerDetector(clock);
  assert.equal(d2.feed('help me'), 'armed');
  now += 2000;
  assert.equal(d2.feed('help'), 'fired');

  // One "help" alone never fires, however often repeated outside
  // the window: the arm expires.
  const d3 = createVoiceTriggerDetector(clock);
  assert.equal(d3.feed('help me'), 'armed');
  now += 5000;
  assert.equal(d3.feed('help'), 'armed');
  now += 5000;
  assert.equal(d3.feed('help'), 'armed');

  // Near-misses never fire: "helpful", "helping", silence.
  const d4 = createVoiceTriggerDetector(clock);
  assert.equal(d4.feed('that was helpful'), 'ignored');
  assert.equal(d4.feed('helping hand'), 'ignored');
  assert.equal(d4.feed('I helped him'), 'ignored');
  assert.equal(d4.feed(''), 'ignored');

  // reset() clears an arm and a cooldown.
  const d5 = createVoiceTriggerDetector(clock);
  assert.equal(d5.feed('help help'), 'fired');
  d5.reset();
  assert.equal(d5.feed('help help'), 'fired');

  console.log('ok — voice trigger: "help help" fires, single help only arms, helpful/helping never fire');
} finally {
  rmSync(out, { recursive: true, force: true });
}
