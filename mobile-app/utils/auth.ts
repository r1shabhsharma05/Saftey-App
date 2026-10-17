import { Alert } from 'react-native';
import { supabase } from './supabase';
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
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (existing) return;

    const meta = (user.user_metadata || {}) as Record<string, string>;
    const uniqueId = `SL-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const { error } = await supabase.from('profiles').insert([
      {
        id: user.id,
        first_name: meta.first_name || '',
        last_name: meta.last_name || '',
        email: user.email || '',
        phone: meta.phone || '',
        address: meta.address || '',
        unique_id: uniqueId,
      },
    ]);
    if (error && error.code !== '23505') {
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
    Alert.alert('Resend Failed', friendlyAuthError(error));
  } else {
    Alert.alert(
      'Email Sent',
      'A fresh confirmation link is on its way. Check your inbox (and spam).'
    );
  }
}
