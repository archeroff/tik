import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase configuration is injected through Vite environment variables.
 *
 * Copy `.env.example` to `.env` and fill in the values from
 * Supabase Dashboard -> Project Settings -> API (the project URL and the
 * public `sb_publishable_...` key). The publishable key is safe to ship in the
 * client — it only carries the `anon` role, which Row Level Security constrains.
 */
const supabaseUrl = import.meta.env.SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** True once the required environment variables are present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

let client: SupabaseClient | null = null;

/** Lazily created so the module can load without configuration. */
export function getClient(): SupabaseClient {
  if (!client) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    client = createClient(supabaseUrl!, supabasePublishableKey!);
  }
  return client;
}
