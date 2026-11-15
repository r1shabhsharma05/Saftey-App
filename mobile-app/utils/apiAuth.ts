// Backend auth header — the single place every backend call gets its
// credential. The Supabase access token (from the signed-in session)
// rides as `Authorization: Bearer <token>`; the old shared
// EXPO_PUBLIC_API_SECRET / x-api-key header is gone — EXPO_PUBLIC_*
// values ship inside the APK, so a shared secret must never be sent
// from the client. Calls made before sign-in (signup/login code
// request + verify, forgot-password) have no session, so they send
// no Authorization header; the server leaves those endpoints
// unauthenticated by design and rate-limits them instead.
import { supabase } from './supabase';

export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};
