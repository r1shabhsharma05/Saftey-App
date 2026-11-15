// Shared JWT-auth setup for route tests (run-3 fix round 2).
//
// The shared-key fallback is deleted: route tests authenticate with
// a fake Supabase JWT, verified through the _setAuthTransport seam
// (no network, no real project). The fake transport answers
// GET /auth/v1/user from a token→user map, so tests that need two
// distinct users pass two distinct Bearer tokens. The returned user
// carries a fresh last_sign_in_at, so DELETE /auth/account's
// 15-minute session-freshness check passes unless a test overrides
// the transport itself.
const { _setAuthTransport } = require("../services/supabaseAuth");

const DEFAULT_USER = { id: "test-user", email: "test@example.com" };

const setupJwtAuth = (usersByToken) => {
  const map = usersByToken || { "test-token": DEFAULT_USER };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  _setAuthTransport(async (call) => {
    if (!call.url.includes("/auth/v1/user")) return { status: 200, data: {} };
    const auth = call.headers?.Authorization || "";
    const token = auth.replace(/^Bearer\s+/, "");
    const user = map[token];
    if (!user) return { status: 401, data: {} };
    return {
      status: 200,
      data: { id: user.id, email: user.email, last_sign_in_at: new Date().toISOString() },
    };
  });
};

const teardownJwtAuth = () => _setAuthTransport(null);

const bearer = (token = "test-token") => `Bearer ${token}`;

module.exports = { setupJwtAuth, teardownJwtAuth, bearer, DEFAULT_USER };
