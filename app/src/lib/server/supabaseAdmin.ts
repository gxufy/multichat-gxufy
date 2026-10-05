/* Private server-side Supabase admin client for API routes.
 *
 * Uses service-role key (SUPABASE_SECRET_KEY) which bypasses RLS — never
 * ship this key to the browser.  Exports a getter so every route gets the
 * same cached instance.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------ */
/* Lazy single-instance cache — imported once but client created only  */
/* on first call, so a missing env var does not break static builds.   */
/* ------------------------------------------------------------------ */

let client: SupabaseClient | null = null;

/**
 * Return a cached admin client, creating one lazily on first call.
 *
 * Throws when SUPABASE_URL or SUPABASE_SECRET_KEY is absent.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error('Server configuration is incomplete.');
  }

  client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return client;
}
