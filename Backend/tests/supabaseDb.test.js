// Unit tests for services/supabaseDb.js — the D3 PostgREST writer.
//
// Same shape as the D2 redis/qstash tests: env-gated, never-throwing,
// fake transport. No network, no real Supabase project needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  dbStatus,
  dbUpsert,
  dbSelectOne,
  _setDbTransport,
} = require("../services/supabaseDb");

const OLD_URL = process.env.SUPABASE_URL;
const OLD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const setEnv = (url, key) => {
  if (url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = url;
  if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
};

test("unconfigured: status false, writes and reads fail honestly without network", async () => {
  setEnv(undefined, undefined);
  try {
    assert.deepEqual(dbStatus(), { configured: false });
    const up = await dbUpsert("sos_alerts", { id: "x" });
    assert.equal(up.ok, false);
    const sel = await dbSelectOne("sos_alerts", "x");
    assert.equal(sel.ok, false);
  } finally {
    setEnv(OLD_URL, OLD_KEY);
  }
});

test("upsert posts to PostgREST with merge-duplicates and service-role auth", async () => {
  setEnv("https://example.supabase.co", "service-role-key");
  const calls = [];
  _setDbTransport(async (call) => {
    calls.push(call);
    return { data: null };
  });
  try {
    const res = await dbUpsert("sos_alerts", { id: "abc", state: "created" });
    assert.equal(res.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.ok(calls[0].url.includes("/rest/v1/sos_alerts"));
    assert.ok(calls[0].url.includes("on_conflict=id"));
    assert.equal(calls[0].headers.apikey, "service-role-key");
    assert.equal(calls[0].headers.Authorization, "Bearer service-role-key");
    assert.equal(calls[0].headers.Prefer, "resolution=merge-duplicates,return=minimal");
    assert.deepEqual(calls[0].body, { id: "abc", state: "created" });
  } finally {
    _setDbTransport(null);
    setEnv(OLD_URL, OLD_KEY);
  }
});

test("selectOne returns the row, and not_found when the array is empty", async () => {
  setEnv("https://example.supabase.co", "service-role-key");
  let next = [{ id: "abc", state: "delivered" }];
  _setDbTransport(async (call) => {
    assert.equal(call.method, "GET");
    assert.ok(call.url.includes("id=eq.abc"));
    return { data: next };
  });
  try {
    const hit = await dbSelectOne("sos_alerts", "abc");
    assert.equal(hit.ok, true);
    assert.equal(hit.row.state, "delivered");
    next = [];
    const miss = await dbSelectOne("sos_alerts", "abc");
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "not_found");
  } finally {
    _setDbTransport(null);
    setEnv(OLD_URL, OLD_KEY);
  }
});

test("transport errors never throw — they return ok:false", async () => {
  setEnv("https://example.supabase.co", "service-role-key");
  _setDbTransport(async () => {
    throw new Error("network down");
  });
  try {
    const res = await dbUpsert("sos_alerts", { id: "abc" });
    assert.equal(res.ok, false);
    assert.match(res.reason, /network down/);
  } finally {
    _setDbTransport(null);
    setEnv(OLD_URL, OLD_KEY);
  }
});
