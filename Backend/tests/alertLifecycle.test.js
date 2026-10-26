// Unit tests for services/alertLifecycle.js — the D3 SOS alert state machine.
//
// States (plan D3): created → dispatching → delivered → acked → closed,
// plus failed (dispatching → failed on total delivery failure, failed →
// dispatching on retry — without it a failed alert would sit in
// "dispatching" forever, which is a lie about its state).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ALERT_STATES,
  ALLOWED_TRANSITIONS,
  createAlert,
  transition,
} = require("../services/alertLifecycle");

test("createAlert starts in created with history and counters", () => {
  const alert = createAlert({ contactsCount: 3 });
  assert.equal(alert.state, "created");
  assert.equal(alert.contacts, 3);
  assert.equal(alert.sent, 0);
  assert.equal(alert.failed, 0);
  assert.ok(alert.id);
  assert.ok(alert.createdAt);
  assert.equal(alert.history.length, 1);
  assert.equal(alert.history[0].state, "created");
});

test("the happy path walks created → dispatching → delivered → acked → closed", () => {
  const alert = createAlert();
  for (const next of ["dispatching", "delivered", "acked", "closed"]) {
    transition(alert, next);
    assert.equal(alert.state, next);
  }
  assert.equal(alert.history.length, 5);
});

test("delivered can close directly without an ack", () => {
  const alert = createAlert();
  transition(alert, "dispatching");
  transition(alert, "delivered");
  transition(alert, "closed");
  assert.equal(alert.state, "closed");
});

test("dispatching → failed → dispatching is the retry path", () => {
  const alert = createAlert();
  transition(alert, "dispatching");
  transition(alert, "failed");
  transition(alert, "dispatching");
  assert.equal(alert.state, "dispatching");
});

test("illegal transitions throw and leave the state untouched", () => {
  const alert = createAlert();
  assert.throws(() => transition(alert, "delivered"), /Illegal alert transition/);
  assert.throws(() => transition(alert, "closed"), /Illegal alert transition/);
  assert.equal(alert.state, "created");
  transition(alert, "dispatching");
  transition(alert, "delivered");
  transition(alert, "acked");
  transition(alert, "closed");
  assert.throws(() => transition(alert, "dispatching"), /Illegal alert transition/);
  assert.equal(alert.state, "closed");
});

test("transition records a history entry with the note", () => {
  const alert = createAlert();
  transition(alert, "dispatching", "telegram fan-out started");
  assert.equal(alert.history[1].state, "dispatching");
  assert.equal(alert.history[1].note, "telegram fan-out started");
  assert.ok(alert.history[1].at);
});

test("every state in the machine is reachable from the transition map", () => {
  for (const state of ALERT_STATES) {
    assert.ok(state in ALLOWED_TRANSITIONS, `${state} missing from transition map`);
  }
  assert.equal(ALERT_STATES.length, 6);
});
