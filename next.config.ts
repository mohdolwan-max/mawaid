import type { NextConfig } from "next";

// Derived at build/runtime from the configured Supabase project so the CSP
// tracks whichever project's URL is set (no separate env var to keep in
// sync). Falls back to allowing any *.supabase.co host if the env var is
// somehow missing, rather than breaking the app.
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "*.supabase.co";
  }
})();

// Next.js's dev server (Fast Refresh/Turbopack HMR) evals code at runtime,
// which a strict CSP blocks — 'unsafe-eval' is only added outside
// production so the real deployed CSP stays strict.
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts + hydration data; a full
  // nonce-based CSP is a larger refactor than warranted right now.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${supabaseHost}`,
  "font-src 'self' data:",
  `connect-src 'self' https://${supabaseHost} wss://${supabaseHost}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // geolocation=(self): NearMeBar (0031) asks for the customer's
  // position to show nearby clinics — a blanket geolocation=() predates
  // that feature and was silently killing it on every browser, on both
  // mobile and desktop, with no error a user could act on (the API call
  // fails at the policy level before it ever reaches a permission
  // prompt). "self" still blocks any third-party content embedded in
  // the page from requesting it — nothing here needs that.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Applies to every route except the service worker, which needs
        // its own scope/MIME handling and is same-origin static anyway.
        source: "/((?!sw\\.js).*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
