// 🔐 Evidence Vault — SafeLife 2.0 Day 27 (plan §6 D27, §3 F5).
//
// The vault proves the recorded evidence is intact: for each
// registered chunk (vault order — audio, then video, by index) the
// server downloads the bytes from the private `evidence` Storage
// bucket, SHA-256s them, and chains the hashes — chain[i] =
// sha256(chain[i-1] + sha256(bytes[i])), chain[-1] = "". Change one
// byte anywhere and every chain hash after it (including the root)
// changes, so a tampered chunk is caught, not silently trusted.
//
// The server never sees the bytes at register time (the app uploads
// straight to Storage), so hashing happens here at verify time —
// the vault reads bytes it can verify itself. A chunk whose bytes
// are missing from the bucket is listed in `missing` and fails the
// vault (ok:false), never silently skipped.
//
// Degradation: without SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY the
// vault cannot download bytes, so verify returns ok:false with
// reason "storage_not_configured" and the registry list unverified —
// the endpoint still answers 200, the failure is inside the payload.
// Nothing here ever throws.
const crypto = require("node:crypto");
const axios = require("axios");
const evidenceStore = require("./evidenceStore");

const sha256hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// Pure chain over per-chunk SHA-256 hex strings, in vault order.
// Returns { chain, rootHash } — rootHash is null for zero chunks.
const computeChain = (hashes) => {
  const chain = [];
  let prev = "";
  for (const h of hashes) {
    prev = sha256hex(Buffer.from(prev + h, "utf8"));
    chain.push(prev);
  }
  return { chain, rootHash: chain.length ? chain[chain.length - 1] : null };
};

// Production transport: one Storage object download with the
// service_role key (server-side only — the bucket is private and the
// app's anon key cannot read it). The test seam replaces this
// wholesale; the verifiers below never see axios directly.
const defaultDownload = async (storagePath) => {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return { ok: false, reason: "storage_not_configured" };
  const encoded = storagePath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  try {
    const resp = await axios({
      method: "GET",
      url: `${url}/storage/v1/object/evidence/${encoded}`,
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      responseType: "arraybuffer",
      timeout: 10000,
    });
    return { ok: true, bytes: Buffer.from(resp.data) };
  } catch (err) {
    return { ok: false, reason: err.response?.status === 404 ? "not_found" : err.message };
  }
};

let downloadChunkBytes = defaultDownload;

const storageConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

// Verify every registered chunk for one alert. Always returns a
// vault object, never throws.
const verifyAlert = async (alertId) => {
  const chunks = await evidenceStore.list(alertId);
  const verifiedAt = new Date().toISOString();
  // Zero chunks is an honest empty vault — nothing to download, so
  // storage config is irrelevant here (checked below only when
  // there is actually something to verify).
  if (chunks.length === 0) {
    return { alertId, ok: true, verified: false, reason: null, chunks: [], rootHash: null, missing: [], verifiedAt };
  }
  if (!storageConfigured()) {
    return {
      alertId,
      ok: false,
      verified: false,
      reason: "storage_not_configured",
      chunks: chunks.map((c) => ({ ...c, sha256: null, chainHash: null, verified: false })),
      rootHash: null,
      missing: chunks.map((c) => c.storagePath),
      verifiedAt,
    };
  }
  const hashes = [];
  const verifiedChunks = [];
  const missing = [];
  for (const chunk of chunks) {
    const dl = await downloadChunkBytes(chunk.storagePath);
    if (!dl.ok) {
      missing.push(chunk.storagePath);
      verifiedChunks.push({ ...chunk, sha256: null, chainHash: null, verified: false });
      continue;
    }
    const hash = sha256hex(dl.bytes);
    hashes.push(hash);
    verifiedChunks.push({ ...chunk, sha256: hash, chainHash: null, verified: true });
  }
  const { chain, rootHash } = computeChain(hashes);
  // Chain hashes attach only to verified chunks, in vault order.
  let i = 0;
  for (const vc of verifiedChunks) {
    if (vc.verified) vc.chainHash = chain[i++];
  }
  return {
    alertId,
    ok: missing.length === 0,
    verified: missing.length === 0 && chunks.length > 0,
    reason: missing.length ? "chunks_missing_from_storage" : null,
    chunks: verifiedChunks,
    rootHash,
    missing,
    verifiedAt,
  };
};

// The shareable integrity proof: everything a third party needs to
// re-verify the evidence independently (re-download each chunk from
// the bucket by path, re-hash, re-chain, compare rootHash).
const buildProof = (vault) => ({
  version: 1,
  alertId: vault.alertId,
  exportedAt: new Date().toISOString(),
  verified: vault.verified,
  rootHash: vault.rootHash,
  verifiedAt: vault.verifiedAt,
  chunks: vault.chunks.map((c) => ({
    kind: c.kind,
    index: c.index,
    storagePath: c.storagePath,
    bytes: c.bytes,
    mime: c.mime,
    uploadedAt: c.uploadedAt,
    sha256: c.sha256,
    chainHash: c.chainHash,
    verified: c.verified,
  })),
});

module.exports = {
  sha256hex,
  computeChain,
  verifyAlert,
  buildProof,
  // Test seam only — pass null to restore the production transport.
  _setStorageDownload: (fn) => {
    downloadChunkBytes = fn || defaultDownload;
  },
};
