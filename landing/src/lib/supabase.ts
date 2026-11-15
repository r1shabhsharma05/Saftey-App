import { createClient } from "@supabase/supabase-js";

// Same Supabase project as the SafeLife app. The anon key is publishable,
// but it is NOT inlined here: the single source is the
// VITE_SUPABASE_ANON_KEY env var (set in the Vercel 'landing' project).
// A missing key fails fast with a clear message instead of silently
// falling back to a stale literal baked into the bundle (run-4 F-11.3:
// the old fallback literal drifted from the single source). Never paste
// a key value into this file.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://xkfrsjtfbylhhrvibmxk.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseAnonKey) {
  throw new Error(
    "VITE_SUPABASE_ANON_KEY is not set — set it in the Vercel 'landing' project (Environment Variables, Production) or in .env for local dev."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Auth pages redirect back here after email confirmation / Google OAuth.
// The origin is allow-listed in the project's Supabase auth config.
export const AUTH_REDIRECT_URL =
  "https://landing-rosy-delta-55.vercel.app/#auth";
