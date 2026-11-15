// H15 DOB-backfill race guard.
//
// login.tsx and register.tsx set this flag while backfilling a
// pre-gate account's date of birth (POST /auth/profile/dob +
// session refresh). The root layout's DOB backstop reads it before signing
// out a session whose LOCAL JWT still lacks
// user_metadata.date_of_birth: while a backfill is in flight the
// sign-out would kill the very session the POST authenticates with
// (its Authorization header comes from that session) and strand
// the user signed out on /login.
//
// The flag is set BEFORE the sign-in that creates the session
// (handleCodeComplete sets it before signInWithPassword,
// handleGoogle before signInWithGoogle), so no ordering between
// the auth listener and the login handler can beat it — the
// session cannot exist before the flag. It is cleared on EVERY
// exit of those handlers (finally), and it self-expires after 10
// minutes, so a stuck flag can never permanently disable the
// backstop: worst case the gate is deferred for one sign-in
// window, and the backstop still runs on the next launch or
// session change. Fail-closed by construction: the layout only
// DEFERS the sign-out while a backfill is in flight — it never
// routes a DOB-less session into the tabs.

import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { validateDateOfBirth } from './dob';

const DOB_BACKFILL_WINDOW_MS = 10 * 60 * 1000;

let backfillStartedAt = 0;

export function setDobBackfillInProgress(active: boolean): void {
  backfillStartedAt = active ? Date.now() : 0;
}

export function isDobBackfillInProgress(): boolean {
  return backfillStartedAt !== 0 && Date.now() - backfillStartedAt < DOB_BACKFILL_WINDOW_MS;
}

// After POST /auth/profile/dob succeeds, the DOB lives server-side
// but the local JWT still carries the old user_metadata — the root
// layout's DOB backstop reads the LOCAL session, so it would sign
// this session out. Refresh the session so the new JWT carries
// user_metadata.date_of_birth BEFORE the backstop re-checks:
// refreshSession() re-fetches the user from Supabase and fires
// TOKEN_REFRESHED, which updates the layout's session state.
// Returns the refreshed user, or null when the refresh failed or
// the fresh JWT still lacks a valid DOB — the caller signs out,
// fail-closed (the DOB is saved server-side, so the next sign-in
// lands with it on record). Shared by login.tsx and register.tsx.
export async function refreshSessionWithDob(): Promise<User | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data.session?.user) return null;
  const metaDob = (data.session.user.user_metadata as Record<string, unknown> | undefined)
    ?.date_of_birth;
  if (typeof metaDob !== 'string' || !validateDateOfBirth(metaDob).ok) return null;
  return data.session.user;
}
