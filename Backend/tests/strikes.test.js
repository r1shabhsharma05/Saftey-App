// Anti-abuse D23 tests — SafeLife 2.0 Day 23: IP-keyed strikes.
// Pure service, no network, no clock dependence (nowMs injected).
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STRIKE_WINDOW_MS,
  STRIKE_LIMIT,
  BLOCK_MS,
  recordStrike,
  strikeCount,
  isBlocked,
  blockedUntilMs,
  _reset,
} = require("../services/strikes");

const T0 = Date.parse("2026-11-14T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

test("constants: 3 strikes in 24h blocks for 1h", () => {
  assert.equal(STRIKE_LIMIT, 3);
  assert.equal(STRIKE_WINDOW_MS, 24 * HOUR);
  assert.equal(BLOCK_MS, HOUR);
});

test("unknown actor has zero strikes and is not blocked", () => {
  _reset();
  assert.equal(strikeCount("ip:1.2.3.4", { nowMs: T0 }), 0);
  assert.equal(isBlocked("ip:1.2.3.4", { nowMs: T0 }), false);
  assert.equal(blockedUntilMs("ip:1.2.3.4", { nowMs: T0 }), 0);
});

test("1-2 strikes do not block; 3rd strike blocks", () => {
  _reset();
  const actor = "ip:1.2.3.4";
  assert.equal(recordStrike(actor, "false-alarm", { nowMs: T0 }), 1);
  assert.equal(isBlocked(actor, { nowMs: T0 }), false);
  assert.equal(recordStrike(actor, "false-alarm", { nowMs: T0 + 1000 }), 2);
  assert.equal(isBlocked(actor, { nowMs: T0 + 1000 }), false);
  assert.equal(recordStrike(actor, "false-alarm", { nowMs: T0 + 2000 }), 3);
  assert.equal(isBlocked(actor, { nowMs: T0 + 2000 }), true);
  assert.equal(blockedUntilMs(actor, { nowMs: T0 + 2000 }), T0 + 2000 + HOUR);
});

test("block lifts 1h after the last strike", () => {
  _reset();
  const actor = "ip:1.2.3.4";
  recordStrike(actor, "false-alarm", { nowMs: T0 });
  recordStrike(actor, "false-alarm", { nowMs: T0 + 1000 });
  recordStrike(actor, "false-alarm", { nowMs: T0 + 2000 });
  assert.equal(isBlocked(actor, { nowMs: T0 + 2000 + HOUR - 1 }), true);
  assert.equal(isBlocked(actor, { nowMs: T0 + 2000 + HOUR }), false);
});

test("a further strike while blocked extends the block 1h from that strike", () => {
  _reset();
  const actor = "ip:1.2.3.4";
  recordStrike(actor, "false-alarm", { nowMs: T0 });
  recordStrike(actor, "false-alarm", { nowMs: T0 + 1000 });
  recordStrike(actor, "false-alarm", { nowMs: T0 + 2000 });
  assert.equal(recordStrike(actor, "code-brute-force", { nowMs: T0 + 30 * 60 * 1000 }), 4);
  assert.equal(blockedUntilMs(actor, { nowMs: T0 + 30 * 60 * 1000 }), T0 + 30 * 60 * 1000 + HOUR);
});

test("strikes older than 24h do not count", () => {
  _reset();
  const actor = "ip:1.2.3.4";
  recordStrike(actor, "false-alarm", { nowMs: T0 });
  recordStrike(actor, "false-alarm", { nowMs: T0 + 1000 });
  recordStrike(actor, "false-alarm", { nowMs: T0 + 2000 });
  assert.equal(strikeCount(actor, { nowMs: T0 + 24 * HOUR + 3000 }), 0);
  assert.equal(isBlocked(actor, { nowMs: T0 + 24 * HOUR + 3000 }), false);
});

test("strikes are per-actor: one IP's strikes never block another", () => {
  _reset();
  for (let i = 0; i < 3; i++) recordStrike("ip:1.2.3.4", "false-alarm", { nowMs: T0 + i });
  assert.equal(isBlocked("ip:5.6.7.8", { nowMs: T0 + 10 }), false);
  assert.equal(strikeCount("ip:5.6.7.8", { nowMs: T0 + 10 }), 0);
});

test("bad actor input never throws and never blocks", () => {
  _reset();
  assert.equal(recordStrike("", "false-alarm", { nowMs: T0 }), 0);
  assert.equal(recordStrike(null, "false-alarm", { nowMs: T0 }), 0);
  assert.equal(isBlocked("", { nowMs: T0 }), false);
  assert.equal(isBlocked(null, { nowMs: T0 }), false);
});
