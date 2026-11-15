// F-M1 test: a 10-contact max-size queued battery-alert payload must
// serialize under SecureStore's 2048-byte Android cap.
//
// No test runner is installed in mobile-app, so this script compiles
// the real utils/batteryAlerts.ts with the project's TypeScript into
// a temp dir and asserts against the compiled output (no logic is
// duplicated here — the worst case is built from the real helper).
// Run: `npm test` (or `node scripts/check-battery-queue-size.mjs`).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'safelife-battery-queue-'));
try {
  execFileSync(join(root, 'node_modules', '.bin', 'tsc'), [
    'utils/batteryAlerts.ts',
    'constants/batteryThresholds.ts',
    '--outDir', out,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--moduleResolution', 'node',
    '--skipLibCheck',
  ], { cwd: root, stdio: 'pipe' });
  const { buildQueuedBatteryAlertPayload } = await import(join(out, 'utils', 'batteryAlerts.js'));

  // Worst case: 10 contacts with absurdly long names/phones, a long
  // user name/phone, and a 'final' burst naming a long alertId.
  const queued = buildQueuedBatteryAlertPayload({
    kind: 'final',
    lat: '28.612345',
    lng: '77.229999',
    name: 'A'.repeat(200),
    phone: '+91123456789012345678901234567890',
    battery: 5,
    contacts: Array.from({ length: 10 }, (_, i) => ({
      name: `Contact Number ${i} `.repeat(20),
      phone: `+9198765432${String(i).padStart(2, '0')}000000000000000000`,
    })),
    alertId: 'x'.repeat(100),
  });
  const stored = JSON.stringify({ payload: queued, queuedAt: 1780000000000, nextRetryAt: 1780000000000 });
  assert.ok(
    stored.length < 2048,
    `queued battery alert is ${stored.length} bytes, over SecureStore's 2048-byte Android cap`
  );

  // Caps mirror the server (Backend/routes/alerts.js POST /battery-alert).
  assert.equal(queued.name.length, 100, 'user name truncated to the server cap');
  assert.equal(queued.phone.length, 30, 'user phone truncated to the server cap');
  assert.ok(
    (queued.contacts).every((c) => c.name.length <= 60 && c.phone.length <= 20),
    'contact name/phone truncated to the server caps'
  );
  assert.equal(queued.contacts.length, 10, 'contacts capped at 10');
  assert.ok(
    (queued.contacts).every((c) => !('pushToken' in c)),
    'no pushToken in the queued payload (the contacts cache carries none)'
  );
  // Everything the retry path reads or re-sends survives the shrink.
  assert.equal(queued.kind, 'final');
  assert.equal(queued.alertId, 'x'.repeat(100));
  assert.equal(queued.lat, '28.612345');
  assert.equal(queued.battery, 5);

  // 12 contacts in → 10 out.
  const over = buildQueuedBatteryAlertPayload({
    kind: 'low',
    lat: '0',
    lng: '0',
    name: 'U',
    phone: '1',
    battery: 15,
    contacts: Array.from({ length: 12 }, () => ({ name: 'N', phone: '1' })),
  });
  assert.equal(over.contacts.length, 10, 'contacts sliced to 10');
  assert.ok(!('alertId' in over), 'low alerts carry no alertId');

  console.log(`ok — worst-case queued battery alert: ${stored.length} bytes (< 2048)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
