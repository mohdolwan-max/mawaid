import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Creates a Supabase client bound to the current request's cookies.
// Call fresh in every Server Component / Server Action / Route Handler —
// do not cache the instance across requests.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component render — Next.js
            // doesn't allow writing cookies there, so this is a silent
            // no-op. Anything that needs to actually clear/refresh a
            // cookie (e.g. signing out an invalid session) must run from
            // a Server Action or Route Handler instead — see
            // src/app/auth/signout/route.ts and the comment in
            // src/lib/org.ts's requireOrgContext().
          }
        },
      },
    }
  );
}
