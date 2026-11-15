// Phone auth client — SafeLife phone-OTP signup + phone-OTP login.
//
// Thin API client for POST /auth/signup/*, /auth/login/*,
// /auth/forgot-password and DELETE /auth/account, mirroring the
// guardian client (utils/guardian.ts): 30 s timeout and a `reached`
// flag so the caller can tell "the server answered but refused"
// apart from "the request never left the phone". Authenticated calls
// send `Authorization: Bearer <Supabase access token>` (see
// utils/apiAuth.ts); the old shared EXPO_PUBLIC_API_SECRET /
// x-api-key header is gone — it shipped inside the APK. The code
// request/verify calls run before sign-in, so they send no
// Authorization header. The verification code is never stored on
// the device and never logged — it is typed by the user and sent
// once, then forgotten.
//
// Retry rule: request-code retries ONCE on timeout only — the server
// may simply have been slow. Verify NEVER retries: a first attempt
// that timed out may already have consumed the code server-side,
// and a retry would report "no code pending" for a verification
// that actually succeeded.

import { getAuthHeaders } from './apiAuth';

export type PostFailure = 'timeout' | 'network';

export interface CodeRequestResult {
  reached: boolean;
  success: boolean;
  sent: boolean;
  reason?: string;
  error?: string;
  failure?: PostFailure;
}

export interface VerifyResult {
  reached: boolean;
  success: boolean;
  /** Short-lived, single-use proof binding (phone, expiry) — spent at signup-complete. */
  proof?: string;
  /** Login verify only: the account email to sign in with. */
  email?: string;
  error?: string;
  failure?: PostFailure;
}

export interface CompleteSignupResult {
  reached: boolean;
  success: boolean;
  error?: string;
  failure?: PostFailure;
}

export interface SimpleResult {
  reached: boolean;
  success: boolean;
  error?: string;
  failure?: PostFailure;
  /** DELETE /auth/account answered 401 REAUTH_REQUIRED: the session
   * is older than 15 min — re-authenticate, then retry once. */
  reauthRequired?: boolean;
}

export interface LoginPrecheckResult {
  /** false only when the server answered 429 (too many attempts). */
  allowed: boolean;
  /** Seconds to wait before retrying (429 only). */
  retryAfterSeconds?: number;
  /** false = the precheck never reached the server — fail OPEN. */
  reached: boolean;
}

/** Login-attempt precheck (2.4): POST /auth/login/precheck {email}
 * answers 200 {allowed:true} or 429 {allowed:false,
 * retryAfterSeconds}. Call BEFORE supabase signInWithPassword; on
 * 429 do NOT attempt sign-in. On network error (reached:false) the
 * caller proceeds with sign-in — fail-open for availability, since
 * Supabase still enforces its own server-side limits. */
export const checkLoginPrecheck = async (
  backendUrl: string,
  email: string
): Promise<LoginPrecheckResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${backendUrl}/auth/login/precheck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (response.status === 429) {
      const retryAfter =
        data && typeof data === 'object' && typeof (data as { retryAfterSeconds?: unknown }).retryAfterSeconds === 'number'
          ? (data as { retryAfterSeconds: number }).retryAfterSeconds
          : undefined;
      return { allowed: false, retryAfterSeconds: retryAfter, reached: true };
    }
    if (!response.ok) return { allowed: true, reached: true };
    const allowed =
      !data || typeof data !== 'object' || (data as { allowed?: unknown }).allowed !== false;
    return { allowed, reached: true };
  } catch {
    return { allowed: true, reached: false };
  } finally {
    clearTimeout(timeout);
  }
};

const phoneAuthHeaders = async (): Promise<Record<string, string>> => ({
  'Content-Type': 'application/json',
  ...(await getAuthHeaders()),
});

const postJson = async (
  url: string,
  body: Record<string, unknown>,
  retryOnTimeout: boolean
): Promise<{ reached: boolean; data: unknown; failure?: PostFailure }> => {
  let lastFailure: PostFailure = 'network';
  const attempts = retryOnTimeout ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: await phoneAuthHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      return { reached: true, data };
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      lastFailure = isTimeout ? 'timeout' : 'network';
      // No phone numbers or codes in logs — the URL carries none.
      console.log(`phoneAuth ${url} attempt ${attempt + 1} failed:`, err instanceof Error ? err.name : 'unknown');
      if (!isTimeout || attempt === attempts - 1) {
        return { reached: false, data: null, failure: lastFailure };
      }
      // One retry, timeout only — the server may have been slow.
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      clearTimeout(timeout);
    }
  }
  return { reached: false, data: null, failure: lastFailure };
};

const toCodeRequestResult = (data: unknown, reached: boolean, failure?: PostFailure): CodeRequestResult => {
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, sent: false, failure };
  }
  const d = data as { success?: boolean; sent?: boolean; reason?: unknown; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    sent: !!d.sent,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

/** Step 1 of phone-OTP signup: SMS the 6-digit code to the phone.
 * turnstileToken comes from the Turnstile widget
 * (components/TurnstileWidget.tsx) — omitted when the widget is not
 * configured, in which case the server decides (fail-open until
 * TURNSTILE_SECRET_KEY is set in Vercel; see the widget). */
export const requestSignupCode = async (
  backendUrl: string,
  phone: string,
  turnstileToken?: string
): Promise<CodeRequestResult> => {
  const { reached, data, failure } = await postJson(
    `${backendUrl}/auth/signup/request-code`,
    { phone, ...(turnstileToken ? { turnstileToken } : {}) },
    true
  );
  return toCodeRequestResult(data, reached, failure);
};

/** Step 2 of phone-OTP signup: server-side verdict on the code + proof token. */
export const verifySignupCode = async (
  backendUrl: string,
  phone: string,
  code: string
): Promise<VerifyResult> => {
  const { reached, data, failure } = await postJson(`${backendUrl}/auth/signup/verify-code`, { phone, code }, false);
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, failure };
  }
  const d = data as { success?: boolean; proof?: unknown; proofToken?: unknown; token?: unknown; error?: unknown };
  const proof = [d.proof, d.proofToken, d.token].find((v) => typeof v === 'string') as string | undefined;
  return {
    reached: true,
    success: !!d.success,
    proof,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

/** Step 3 of phone-OTP signup: spend the proof to create the account server-side. */
export const completeSignup = async (
  backendUrl: string,
  input: { proof: string; email: string; password: string; name: string; phone: string }
): Promise<CompleteSignupResult> => {
  const { reached, data, failure } = await postJson(`${backendUrl}/auth/signup/complete`, { ...input }, false);
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, failure };
  }
  const d = data as { success?: boolean; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

/** Step 1 of phone-OTP login: SMS the 6-digit code to the phone.
 * turnstileToken comes from the Turnstile widget, same as signup. */
export const requestLoginCode = async (
  backendUrl: string,
  phone: string,
  turnstileToken?: string
): Promise<CodeRequestResult> => {
  const { reached, data, failure } = await postJson(
    `${backendUrl}/auth/login/request-code`,
    { phone, ...(turnstileToken ? { turnstileToken } : {}) },
    true
  );
  return toCodeRequestResult(data, reached, failure);
};

/** Step 2 of phone-OTP login: server-side verdict; success carries the account email. */
export const verifyLoginCode = async (
  backendUrl: string,
  phone: string,
  code: string
): Promise<VerifyResult> => {
  const { reached, data, failure } = await postJson(`${backendUrl}/auth/login/verify-code`, { phone, code }, false);
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, failure };
  }
  const d = data as { success?: boolean; email?: unknown; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    email: typeof d.email === 'string' ? d.email : undefined,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

/** Forgot password: one generic outcome regardless of whether the number has an account.
 * turnstileToken comes from the Turnstile widget, same as the login
 * request-code call (6.3) — omitted when the widget is unconfigured
 * or the token expired, in which case the server decides (fail-open
 * until TURNSTILE_SECRET_KEY is set in Vercel; see the widget). */
export const requestForgotPassword = async (
  backendUrl: string,
  phone: string,
  turnstileToken?: string
): Promise<SimpleResult> => {
  const { reached, data, failure } = await postJson(
    `${backendUrl}/auth/forgot-password`,
    { phone, ...(turnstileToken ? { turnstileToken } : {}) },
    true
  );
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, failure };
  }
  const d = data as { success?: boolean; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

/** Delete the signed-in account server-side (JWT auth); caller signs out after.
 * The backend requires a FRESH session (last sign-in within 15 min):
 * a stale session answers 401 REAUTH_REQUIRED — surfaced here as
 * reauthRequired so the caller can re-authenticate and retry once
 * instead of reporting a generic failure. */
export const deleteAccount = async (backendUrl: string): Promise<SimpleResult> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${backendUrl}/auth/account`, {
      method: 'DELETE',
      headers: await phoneAuthHeaders(),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    const error =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? ((data as { error: string }).error as string)
        : undefined;
    return {
      reached: true,
      success: response.ok && !!data && typeof data === 'object' && (data as { success?: boolean }).success === true,
      error,
      reauthRequired: response.status === 401 || error === 'REAUTH_REQUIRED',
    };
  } catch (err) {
    return { reached: false, success: false, failure: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timeout);
  }
};
