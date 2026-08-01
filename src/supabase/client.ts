import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase configuration is injected through Vite environment variables.
 *
 * Copy `.env.example` to `.env` and fill in the values from
 * Supabase Dashboard -> Project Settings -> API (the project URL and the
 * public `anon` key). The `anon` key is safe to ship in the client.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True once the required environment variables are present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let client: SupabaseClient | null = null;

/** Lazily created so the module can load without configuration. */
export function getClient(): SupabaseClient {
  if (!client) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    client = createClient(supabaseUrl!, supabaseAnonKey!);
  }
  return client;
}
