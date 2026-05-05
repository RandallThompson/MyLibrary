import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Surfaced in the browser console immediately if env vars are missing.
  // eslint-disable-next-line no-console
  console.error(
    "Supabase env vars missing. Did you create .env.local from .env.example?"
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true // needed so magic-link callback URLs resolve
  }
});
