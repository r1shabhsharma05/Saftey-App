// SafeLife 2.0 Day 29 — POST /risk-score route tests.
// Boots the real router on an ephemeral port (same pattern as the
// other route tests); no network leaves the process.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const riskRouter = require("../routes/risk");
const { recentFeatureEvents } = require("../services/featureLog");

const boot = async () => {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(riskRouter);
  const server = app.listen(0);
  await new Promise((r) => server.on("listening", r));
  return { server, port: server.address().port };
};

const post = (port, body) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: "127.0.0.1", port, path: "/risk-score", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
      }
    );
    req.on("error", reject);
    req.end(data);
  });

test("POST /risk-score scores a night walk HIGH and logs one anonymised row", async () => {
  const { server, port } = await boot();
  try {
    const before = recentFeatureEvents().length;
    const { status, body } = await post(port, {
      localHour: 2, areaType: "other", routeDurationS: 2100, deviationM: 250, lat: 28.6139, lng: 77.209,
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.score, 88);
    assert.equal(body.band, "HIGH");
    assert.equal(body.modelVersion, "rules-v1");
    const rows = recentFeatureEvents();
    assert.equal(rows.length, before + 1);
    assert.equal(rows[rows.length - 1].kind, "risk_score");
    assert.equal(rows[rows.length - 1].cellLat, 28.61);
  } finally {
    server.close();
  }
});

test("garbage body degrades to a scored unknown, never a 500 or an echo", async () => {
  const { server, port } = await boot();
  try {
    const { status, body } = await post(port, { localHour: "soon", areaType: "mars", evil: "<script>" });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.features.areaType, "other");
    assert.ok(body.unknownFactors.includes("time-of-day"));
    assert.ok(!JSON.stringify(body).includes("script"), "unknown fields are never echoed");
  } finally {
    server.close();
  }
});
