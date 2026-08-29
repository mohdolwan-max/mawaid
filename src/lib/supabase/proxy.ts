import { NextResponse, type NextRequest } from "next/server";

// Inverted from a typical "allowlist public paths" model: on this app most
// traffic is the public booking flow (/[orgSlug]/*), so we allowlist the
// PROTECTED prefixes (owner/staff dashboard) instead and treat everything
// else as public by default.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/services",
  "/staff",
  "/bookings",
  "/reviews",
  "/settings",
  "/onboarding",
];

// Customer-facing pages that need a session. /account is deliberately NOT
// here — it renders the login/signup UI itself when signed out (Wddk-style
// "Account tab shows login"), so protecting it would loop.
const CUSTOMER_PROTECTED_PREFIXES = ["/my"];

// Optimistic-only auth check: looks for the presence of a Supabase auth
// cookie without making a network call to Supabase's Auth server. Real,
// authoritative verification happens on the page via requireOrgContext()'s
// get_my_context() RPC (src/lib/org.ts), which redirects to /login itself
// if the JWT is invalid/expired. Proxy only needs to keep signed-out users
// out of the owner/staff app shell.
//
// Deliberately does NOT redirect already-signed-in users away from
// /login or /signup. That redirect used to target a hardcoded /dashboard,
// which raced Next.js's own "revalidate the current page" refetch that
// follows every Server Action: signup's action redirects to /onboarding,
// but the action-triggered GET /signup refetch (now carrying the just-set
// auth cookie) would get intercepted here first and sent to /dashboard
// instead — hijacking the action's actual redirect target. The login/
// signup Server Actions already redirect to the right place on success
// (see src/app/login/actions.ts, src/app/signup/actions.ts); a
// signed-in user who manually revisits /login or /signup just sees the
// form again, which is harmless.
export function updateSession(request: NextRequest) {
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  const isCustomerProtected = CUSTOMER_PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/")
  );

  if (!hasAuthCookie && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (!hasAuthCookie && isCustomerProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/account";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
