// 🔐 Supabase Auth REST — server-side user verification + admin actions.
//
// Why REST, not supabase-js: the backend has no Supabase client
// dependency (supabaseDb.js uses raw REST with axios already), and
// these calls are few. Config is read per call so tests can toggle
// env freely. Nothing here ever throws: every failure is an honest
// { ok: false, reason }.
//
// - verifyUserToken: GET /auth/v1/user with the caller's JWT — the
//   server-side session check requireUser is built on (2.1). The
//   apikey is the anon key when set, else the service_role key.
// - adminCreateUser / adminDeleteUser: the Admin API (service_role
//   only) for signup-complete (R1c) and account deletion (12.3).
// - recoverPassword: POST /auth/v1/recover for forgot-password (2.3).
// - deleteAvatarObject: removes the user's avatar from the private
//   avatars bucket (12.3).
const axios = require("axios");

const getConfig = () => ({
  url: (process.env.SUPABASE_URL || "").replace(/\/$/, ""),
  anonKey: process.env.SUPABASE_ANON_KEY || "",
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
});

// Production transport: one HTTPS call, never throws on HTTP status
// (validateStatus accepts everything — callers read status).
// The test seam replaces this wholesale.
let transport = async (call) => {
  const resp = await axios({
    method: call.method,
    url: call.url,
    data: call.body,
    headers: call.headers,
    timeout: 5000,
    validateStatus: () => true,
  });
  return { status: resp.status, data: resp.data };
};

const authHeaders = (key, bearer) => ({
  apikey: key,
  Authorization: `Bearer ${bearer}`,
  "Content-Type": "application/json",
});

// Verifies a Supabase access token server-side and returns the user
// it belongs to ({ id, email }). A 401 from Auth, a missing id, or
// an unconfigured backend all answer the same invalid-token.
const verifyUserToken = async (token) => {
  const { url, anonKey, serviceKey } = getConfig();
  const apiKey = anonKey || serviceKey;
  if (!url || !apiKey || typeof token !== "string" || !token) {
    return { ok: false, reason: "not_configured" };
  }
  try {
    const { status, data } = await transport({
      method: "GET",
      url: `${url}/auth/v1/user`,
      headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
    });
    if (status !== 200 || !data || typeof data.id !== "string") {
      return { ok: false, reason: "invalid-token" };
    }
    return { ok: true, user: { id: data.id, email: typeof data.email === "string" ? data.email : "" } };
  } catch (err) {
    return { ok: false, reason: err.message || "transport-error" };
  }
};

// Creates the account server-side (signup-complete, R1c): email is
// confirmed at creation (the phone was already proven by OTP), and
// the phone rides in user_metadata. A duplicate email answers the
// same generic failure as any other create error — the route never
// leaks "already registered".
const adminCreateUser = async ({ email, password, name, phone } = {}) => {
  const { url, serviceKey } = getConfig();
  if (!url || !serviceKey) return { ok: false, reason: "not_configured" };
  try {
    const { status, data } = await transport({
      method: "POST",
      url: `${url}/auth/v1/admin/users`,
      headers: authHeaders(serviceKey, serviceKey),
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, phone },
      },
    });
    if (status !== 200 && status !== 201) {
      return { ok: false, reason: `admin-create-${status}` };
    }
    return { ok: true, user: { id: data?.id, email: data?.email } };
  } catch (err) {
    return { ok: false, reason: err.message || "transport-error" };
  }
};

// Deletes the auth user (account deletion, 12.3). The caller's rows
// are wiped separately by the route via dbDelete.
const adminDeleteUser = async (userId) => {
  const { url, serviceKey } = getConfig();
  if (!url || !serviceKey) return { ok: false, reason: "not_configured" };
  if (typeof userId !== "string" || !userId) return { ok: false, reason: "invalid-user" };
  try {
    const { status } = await transport({
      method: "DELETE",
      url: `${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      headers: authHeaders(serviceKey, serviceKey),
    });
    if (status !== 200 && status !== 204) {
      return { ok: false, reason: `admin-delete-${status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message || "transport-error" };
  }
};

// Triggers Supabase's reset-password email server-side (forgot-password,
// 2.3). The route answers the same generic success whether or not an
// account exists; a failure here is logged server-side only.
const recoverPassword = async (email) => {
  const { url, anonKey, serviceKey } = getConfig();
  const apiKey = anonKey || serviceKey;
  if (!url || !apiKey) return { ok: false, reason: "not_configured" };
  try {
    const { status } = await transport({
      method: "POST",
      url: `${url}/auth/v1/recover`,
      headers: authHeaders(apiKey, apiKey),
      body: { email },
    });
    return status === 200 ? { ok: true } : { ok: false, reason: `recover-${status}` };
  } catch (err) {
    return { ok: false, reason: err.message || "transport-error" };
  }
};

// Removes the avatar object from the private avatars bucket
// (account deletion, 12.3). A missing object is still a success.
const deleteAvatarObject = async (userId) => {
  const { url, serviceKey } = getConfig();
  if (!url || !serviceKey) return { ok: false, reason: "not_configured" };
  if (typeof userId !== "string" || !userId) return { ok: false, reason: "invalid-user" };
  try {
    const { status } = await transport({
      method: "DELETE",
      url: `${url}/storage/v1/object/avatars/${encodeURIComponent(userId)}/avatar.jpg`,
      headers: authHeaders(serviceKey, serviceKey),
    });
    return status === 200 || status === 204 || status === 404
      ? { ok: true }
      : { ok: false, reason: `avatar-delete-${status}` };
  } catch (err) {
    return { ok: false, reason: err.message || "transport-error" };
  }
};

module.exports = {
  verifyUserToken,
  adminCreateUser,
  adminDeleteUser,
  recoverPassword,
  deleteAvatarObject,
  // Test seam only — pass null to restore the production transport.
  _setAuthTransport: (fn) => {
    transport =
      fn ||
      (async (call) => {
        const resp = await axios({
          method: call.method,
          url: call.url,
          data: call.body,
          headers: call.headers,
          timeout: 5000,
          validateStatus: () => true,
        });
        return { status: resp.status, data: resp.data };
      });
  },
};
