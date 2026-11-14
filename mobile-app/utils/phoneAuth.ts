// Phone auth client — SafeLife phone-OTP signup + phone-number login.
//
// Thin API client for POST /auth/signup/* and /auth/login/resolve,
// mirroring the guardian client (utils/guardian.ts): 30 s timeout,
// the x-api-key header only when EXPO_PUBLIC_API_SECRET exists, and
// a `reached` flag so the caller can tell "the server answered but
// refused" apart from "the request never left the phone". The
// verification code is never stored on the device and never logged —
// it is typed by the user and sent once, then forgotten.

export interface CodeRequestResult {
  reached: boolean;
  success: boolean;
  sent: boolean;
  reason?: string;
  error?: string;
}

export interface VerifyResult {
  reached: boolean;
  success: boolean;
  error?: string;
}

export interface ResolveResult {
  reached: boolean;
  success: boolean;
  email: string | null;
  error?: string;
}

const phoneAuthHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(process.env.EXPO_PUBLIC_API_SECRET
    ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
    : {}),
});

const postJson = async (
  url: string,
  body: Record<string, unknown>
): Promise<{ reached: boolean; data: unknown }> => {
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
  } catch {
    return { reached: false, data: null };
  } finally {
    clearTimeout(timeout);
  }
};

const toCodeRequestResult = (data: unknown, reached: boolean): CodeRequestResult => {
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, sent: false };
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
  const { reached, data } = await postJson(`${backendUrl}/auth/signup/request-code`, { phone });
  return toCodeRequestResult(data, reached);
};

/** Step 2 of phone-OTP signup: server-side verdict on the code. */
export const verifySignupCode = async (
  backendUrl: string,
  phone: string,
  code: string
): Promise<VerifyResult> => {
  const { reached, data } = await postJson(`${backendUrl}/auth/signup/verify-code`, { phone, code });
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false };
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
  const { reached, data } = await postJson(`${backendUrl}/auth/login/resolve`, { phone });
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, email: null };
  }
  const d = data as { success?: boolean; email?: unknown; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    email: typeof d.email === 'string' ? d.email : null,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};
