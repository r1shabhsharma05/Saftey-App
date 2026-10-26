// 🔌 Supabase PostgREST writer — the D3 Postgres sink for sos_alerts and
// audit_events, over plain HTTPS with the already-installed axios.
//
// Why PostgREST, not a pg client: the backend runs on Vercel serverless
// (same argument as D2's Upstash-REST choice) and adds zero dependencies.
// Writes use the service_role key — server-side only, set in Vercel env,
// NEVER in the mobile app (the app's anon key is public by design and
// these tables carry no policies, so PostgREST denies anon/authenticated
// outright; see the D3 migration). RLS is enabled on both tables.
//
// Degradation rule (same as D2's redis.js): these functions NEVER throw.
// Unconfigured → honest { ok: false }; transport error → logged +
// { ok: false }. A DB outage must never fail an SOS — the in-memory
// alert store and the stdout audit line still carry the alert.
//
// Config is read per call (not at module load): tests toggle env freely.
const axios = require("axios");

const getConfig = () => ({
  url: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  key: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
});

const dbStatus = () => {
  const { url, key } = getConfig();
  return { configured: Boolean(url && key) };
};

// Production transport: one PostgREST call. The test seam replaces this
// wholesale; the wrappers below never see axios directly.
let transport = async (call) => {
  const resp = await axios({
    method: call.method,
    url: call.url,
    data: call.body,
    headers: call.headers,
    timeout: 5000,
  });
  return { data: resp.data };
};

const authHeaders = () => {
  const { key } = getConfig();
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
};

// Upsert by id (merge-duplicates): repeated saves of one alert update
// its row instead of duplicating it — retries and multi-instance saves
// stay idempotent on the primary key. Rows without an id (audit_events
// uses an identity PK) are plain inserts — on_conflict=id with no id
// value would be a malformed upsert, so it is only added when the row
// carries one.
const dbUpsert = async (table, row) => {
  if (!dbStatus().configured) return { ok: false, reason: "not_configured" };
  const { url } = getConfig();
  const suffix = row && row.id ? "?on_conflict=id" : "";
  try {
    await transport({
      method: "POST",
      url: `${url}/rest/v1/${table}${suffix}`,
      headers: { ...authHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: row,
    });
    return { ok: true };
  } catch (err) {
    console.log(`❌ Supabase upsert ${table} failed:`, err.message);
    return { ok: false, reason: err.message };
  }
};

const dbSelectOne = async (table, id) => {
  if (!dbStatus().configured) return { ok: false, reason: "not_configured" };
  const { url } = getConfig();
  try {
    const { data } = await transport({
      method: "GET",
      url: `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=*`,
      headers: authHeaders(),
    });
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, reason: "not_found" };
    }
    return { ok: true, row: data[0] };
  } catch (err) {
    console.log(`❌ Supabase select ${table} failed:`, err.message);
    return { ok: false, reason: err.message };
  }
};

module.exports = {
  dbStatus,
  dbUpsert,
  dbSelectOne,
  // Test seam only — lets tests drive the writer without network.
  // Pass null to restore the production transport.
  _setDbTransport: (fn) => {
    transport =
      fn ||
      (async (call) => {
        const resp = await axios({
          method: call.method,
          url: call.url,
          data: call.body,
          headers: call.headers,
          timeout: 5000,
        });
        return { data: resp.data };
      });
  },
};
