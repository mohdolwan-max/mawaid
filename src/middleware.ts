import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Named/filed as "middleware" rather than Next.js 16's newer "proxy"
// convention (functionally identical, just deprecated naming — see
// node_modules/next/dist/docs/.../middleware.md) because Vercel's
// production build pipeline did not correctly route ANY request when this
// used src/proxy.ts: `next build` succeeded locally and on Vercel with the
// route list printed correctly, the deployment showed "Ready", but every
// request to the deployed URL returned a platform-level 404 (X-Vercel-
// Error: NOT_FOUND) — while the same deployment's protected preview URL
// correctly redirected to Vercel's SSO gate, proving the app itself was
// live. That combination pointed at the edge routing layer failing to
// wire up the newly-renamed "Proxy" convention specifically on Vercel,
// despite Next.js itself building it fine. middleware.ts is deprecated
// but still fully supported — revisit renaming back to proxy.ts once
// Vercel's builder confirms full support.
export function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
