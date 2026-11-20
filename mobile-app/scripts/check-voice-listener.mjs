// D28 test: the wake-word listener glue (utils/voiceListener.ts).
//
// Compiles the real TS with the project TypeScript and drives it
// with a fake speech module (the native module only exists in a
// development build, so the loader seam is what makes this testable
// headlessly). Asserts: unavailable path, denied path, "help help"
// fires once, restart on end, stop() prevents restart.
// Run: `npm test` (or `node scripts/check-voice-listener.mjs`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'safelife-voice-listener-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeModule({ granted = true } = {}) {
  const listeners = new Map();
  const calls = { start: 0, stop: 0 };
  const mod = {
    ExpoSpeechRecognitionModule: {
      start: () => { calls.start += 1; },
      stop: () => { calls.stop += 1; },
      requestPermissionsAsync: async () => ({ granted }),
      addListener: (event, cb) => {
        listeners.set(event, cb);
        return { remove: () => listeners.delete(event) };
      },
    },
  };
  const emit = (event, payload) => listeners.get(event)?.(payload);
  return { mod, calls, emit, listeners };
}

try {
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), [
    'utils/voiceListener.ts',
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--skipLibCheck',
  ], { cwd: root, stdio: 'pipe' });
  const { startVoiceListener } = await import(join(out, 'voiceListener.js'));

  // 1. No native module (Expo Go) → unavailable, never throws.
  {
    const statuses = [];
    const stop = startVoiceListener(
      { onFired: () => assert.fail('must not fire'), onStatus: (s) => statuses.push(s) },
      () => null,
    );
    assert.deepEqual(statuses, ['unavailable']);
    stop();
  }

  // 2. Permission denied → denied, recognizer never started.
  {
    const fake = fakeModule({ granted: false });
    const statuses = [];
    const stop = startVoiceListener(
      { onFired: () => assert.fail('must not fire'), onStatus: (s) => statuses.push(s) },
      () => fake.mod,
    );
    await sleep(10);
    assert.deepEqual(statuses, ['denied']);
    assert.equal(fake.calls.start, 0);
    stop();
  }

  // 3. Granted → listening; "help" alone arms, second "help" fires once.
  {
    const fake = fakeModule();
    const statuses = [];
    let fired = 0;
    const stop = startVoiceListener(
      { onFired: () => { fired += 1; }, onStatus: (s) => statuses.push(s) },
      () => fake.mod,
    );
    await sleep(10);
    assert.deepEqual(statuses, ['listening']);
    assert.equal(fake.calls.start, 1);
    fake.emit('result', { results: [{ transcript: 'help me please' }] });
    assert.equal(fired, 0, 'single help must only arm');
    fake.emit('result', { results: [{ transcript: 'help' }] });
    assert.equal(fired, 1, 'second help inside the window fires');
    fake.emit('result', { results: [{ transcript: 'help help' }] });
    assert.equal(fired, 1, 'cooldown blocks a second SOS from the same outburst');

    // 4. 'end' (silence timeout) restarts the recognizer while active.
    fake.emit('end', null);
    await sleep(900);
    assert.equal(fake.calls.start, 2, 'listener restarts after end');

    // 5. stop() removes listeners and prevents any further restart.
    stop();
    assert.equal(fake.listeners.size, 0);
    fake.emit('end', null);
    await sleep(900);
    assert.equal(fake.calls.start, 2, 'no restart after stop');
  }

  console.log('check-voice-listener: all assertions passed');
} finally {
  rmSync(out, { recursive: true, force: true });
}
