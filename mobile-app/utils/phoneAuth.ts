// Phone auth client — SafeLife phone-OTP signup + phone-number login.
//
// Thin API client for POST /auth/signup/* and /auth/login/resolve,
// mirroring the guardian client (utils/guardian.ts): 30 s timeout,
// the x-api-key header only when EXPO_PUBLIC_API_SECRET exists, and
// a `reached` flag so the caller can tell "the server answered but
// refused" apart from "the request never left the phone". The
// verification code is never stored on the device and never logged —
// it is typed by the user and sent once, then forgotten.
//
// Failure diagnosis (the "No Connection" dialog used to hide all of
// these behind one generic line): a fetch that aborts is a `timeout`
// (the server was slow — Vercel cold start); anything else thrown by
// fetch is `network` (DNS / refused / offline). The caller shows the
// matching message instead of guessing.
//
// Retry rule: request-code and login-resolve retry ONCE on timeout
// only — the server may simply have been slow. Verify NEVER retries:
// a first attempt that timed out may already have consumed the code
// server-side, and a retry would report "no code pending" for a
// verification that actually succeeded.

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
  error?: string;
  failure?: PostFailure;
}

export interface ResolveResult {
  reached: boolean;
  success: boolean;
  email: string | null;
  error?: string;
  failure?: PostFailure;
}

const phoneAuthHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(process.env.EXPO_PUBLIC_API_SECRET
    ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
    : {}),
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
        headers: phoneAuthHeaders(),
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

/** Step 1 of phone-OTP signup: SMS the 6-digit code to the phone. */
export const requestSignupCode = async (
  backendUrl: string,
  phone: string
): Promise<CodeRequestResult> => {
  const { reached, data, failure } = await postJson(`${backendUrl}/auth/signup/request-code`, { phone }, true);
  return toCodeRequestResult(data, reached, failure);
};

/** Step 2 of phone-OTP signup: server-side verdict on the code. */
export const verifySignupCode = async (
  backendUrl: string,
  phone: string,
  code: string
): Promise<VerifyResult> => {
  const { reached, data, failure } = await postJson(`${backendUrl}/auth/signup/verify-code`, { phone, code }, false);
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

/** Phone-number login: resolve the account email for a phone. */
export const resolveLoginEmail = async (
  backendUrl: string,
  phone: string
): Promise<ResolveResult> => {
  const { reached, data, failure } = await postJson(`${backendUrl}/auth/login/resolve`, { phone }, true);
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, email: null, failure };
  }
  const d = data as { success?: boolean; email?: unknown; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    email: typeof d.email === 'string' ? d.email : null,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};
