import { createClient } from "@supabase/supabase-js";

// Same Supabase project as the SafeLife app (public anon key — safe for
// client apps, same value the mobile app ships). Override with env vars
// when the deploy sets them.
const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://xkfrsjtfbylhhrvibmxk.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZnJzanRmYnlsaGhydmlibXhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzODcwNDksImV4cCI6MjEwNzk2MzA0OX0.ypd-j8LROeCjqcTloC2qhUw73gJZA_Hd7fn6KtJSYPE";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Auth pages redirect back here after email confirmation / Google OAuth.
// The origin is allow-listed in the project's Supabase auth config.
export const AUTH_REDIRECT_URL =
  "https://landing-rosy-delta-55.vercel.app/#auth";
