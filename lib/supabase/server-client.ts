import { createClient } from "@supabase/supabase-js";

type Sb = ReturnType<typeof createClient>;

let cached: Sb | null = null;

/** Server-only Supabase client (service role for create pipeline). */
export function getSupabaseAdmin(): Sb | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
