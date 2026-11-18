// 🔐 Evidence Vault client — SafeLife 2.0 Day 27 (plan §6 D27, §3 F5).
//
// Fetches the server-verified hash chain for one alert's recorded
// evidence (GET /alert/:id/evidence/vault) and the shareable
// integrity proof (GET .../vault/export). Auth headers are passed in
// by the caller (getAuthHeaders) instead of imported here, so this
// util stays standalone — the D27 check script compiles it in plain
// node with a stubbed fetch, no react-native import chain.
//
// A null return means "could not reach the vault" (network error or
// non-OK status) — the UI shows that as unavailable, never as
// verified. Verification truth lives in the payload's `verified`
// flag, never in a 200 alone.
export type VaultChunk = {
  kind: 'audio' | 'video';
  index: number;
  storagePath: string;
  bytes: number;
  mime: string;
  uploadedAt: string;
  sha256: string | null;
  chainHash: string | null;
  verified: boolean;
};

export type Vault = {
  alertId: string;
  ok: boolean;
  verified: boolean;
  reason: string | null;
  chunks: VaultChunk[];
  rootHash: string | null;
  missing: string[];
  verifiedAt: string;
};

export type VaultProof = {
  version: 1;
  alertId: string;
  exportedAt: string;
  verified: boolean;
  rootHash: string | null;
  verifiedAt: string;
  chunks: VaultChunk[];
};

const fetchJson = async (
  url: string,
  authHeaders: Record<string, string>
): Promise<unknown | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { headers: authHeaders, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchVault = async (
  backendUrl: string,
  alertId: string,
  authHeaders: Record<string, string>
): Promise<Vault | null> => {
  const data = await fetchJson(
    `${backendUrl}/alert/${encodeURIComponent(alertId)}/evidence/vault`,
    authHeaders
  );
  if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) return null;
  return (data as { vault: Vault }).vault ?? null;
};

export const fetchVaultProof = async (
  backendUrl: string,
  alertId: string,
  authHeaders: Record<string, string>
): Promise<VaultProof | null> => {
  const data = await fetchJson(
    `${backendUrl}/alert/${encodeURIComponent(alertId)}/evidence/vault/export`,
    authHeaders
  );
  if (!data || typeof data !== 'object' || (data as { success?: unknown }).success !== true) return null;
  return (data as { proof: VaultProof }).proof ?? null;
};

// First 12 hex chars — enough to eyeball a hash in the UI; the full
// hash lives in the exported proof, never truncated there.
export const shortHash = (hash: string | null): string => (hash ? `${hash.slice(0, 12)}…` : '—');
