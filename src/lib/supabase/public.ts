import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// A session-free client for genuinely public reads: the marketplace
// directory, a clinic's public profile, its services and its slot list.
// None of those depend on who is asking — they are the same rows for a
// signed-out visitor and for a signed-in owner.
//
// Why this exists at all: the cookie-bound client in ./server.ts calls
// cookies(), and Next refuses to run a dynamic API inside unstable_cache.
// Without a client that touches no request state, every public page had
// to re-query on every single view. Measured from Jordan, one round trip
// to the database is ~450ms and the marketplace pages make several — so
// caching these is worth more than any query tuning.
//
// It is created once per module rather than per request because it holds
// no per-user state to leak: no cookies are read, no session is set, and
// persistSession/autoRefreshToken are off so it never tries to.
export const publicSupabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }
);
