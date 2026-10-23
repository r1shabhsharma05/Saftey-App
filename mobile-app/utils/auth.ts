import { supabase } from './supabase';
import { showAppDialog } from './dialog';
import type { User } from '@supabase/supabase-js';

export interface ProfileData {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
}

/** True when the error is a network/connectivity failure (server unreachable). */
export function isNetworkError(error: any): boolean {
  const msg = (error?.message || '').toLowerCase();
  return (
    msg.includes('network request failed') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('timeout') ||
    error?.name === 'AuthRetryableFetchError'
  );
}

/** Map a Supabase auth error to a clear, human message. */
export function friendlyAuthError(error: any): string {
  if (isNetworkError(error)) {
    return 'Cannot reach the SafeLife servers. Check your internet connection and try again.';
  }
  const msg = error?.message || 'Something went wrong.';
  if (/invalid login credentials/i.test(msg)) {
    return 'Incorrect email or password. Please try again.';
  }
  if (/email not confirmed/i.test(msg)) {
    return 'Please verify your email address first — check your inbox for the confirmation link.';
  }
  if (/already registered|already been registered|user already/i.test(msg)) {
    return 'This email is already registered. Try logging in instead.';
  }
  if (/password/i.test(msg) && /weak|short|least/i.test(msg)) {
    return 'Password must be at least 6 characters long.';
  }
  return msg;
}

/**
 * Ensure a row exists in `profiles` for the user. Creates it from
 * auth metadata on first login (covers email-verified users whose
 * profile was never written at signup time).
 */
export async function ensureProfile(user: User): Promise<void> {
  try {
    const { data: existing, error: existingError } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (existing) return;
    if (existingError) {
      // A failed check (RLS, network) is not "no row" — say so in the
      // log instead of marching into an insert that fails confusingly.
      console.warn('ensureProfile: existence check failed, attempting insert anyway:', existingError.message);
    }

    const meta = (user.user_metadata || {}) as Record<string, string>;
    // Google sign-ins carry full_name/name, not first_name/last_name —
    // split the full name so Google users don't end up with a blank
    // profile (and "Unknown User" on their SOS alerts).
    let firstName = meta.first_name || '';
    let lastName = meta.last_name || '';
    if (!firstName && !lastName) {
      const full = (meta.full_name || meta.name || '').trim();
      if (full) {
        const parts = full.split(/\s+/);
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      }
    }
    const row = {
      id: user.id,
      first_name: firstName,
      last_name: lastName,
      email: user.email || '',
      phone: meta.phone || '',
      address: meta.address || '',
    };
    // 8 random chars (36^8) instead of 4 — and a 23505 is only benign
    // when it's our OWN row (a duplicate ensureProfile call). If the
    // unique_id collided with another user, no row was created; the old
    // code swallowed that too, leaving the profile blank forever.
    const newUniqueId = () =>
      `SL-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    let { error } = await supabase
      .from('profiles')
      .insert([{ ...row, unique_id: newUniqueId() }]);
    if (error?.code === '23505') {
      const { data: own } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();
      if (!own) {
        ({ error } = await supabase
          .from('profiles')
          .insert([{ ...row, unique_id: newUniqueId() }]));
      } else {
        error = null;
      }
    }
    if (error) {
      console.log('ensureProfile: insert failed (non-fatal):', error.message);
    }
  } catch (e: any) {
    // Non-fatal: the app works without the profile row; never block login.
    console.log('ensureProfile: skipped:', e?.message);
  }
}

/** Resend the signup confirmation email. */
export async function resendConfirmation(email: string): Promise<void> {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) {
    showAppDialog('Resend Failed', friendlyAuthError(error));
  } else {
    showAppDialog(
      'Email Sent',
      'A fresh confirmation link is on its way. Check your inbox (and spam).'
    );
  }
}
