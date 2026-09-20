// Same NEXT_PUBLIC_SITE_HOST convention already used by the booking
// confirmation email and the customer email-verification redirect
// (src/app/[orgSlug]/book/actions.ts, src/app/account/actions.ts) —
// centralized here for robots.ts/sitemap.ts rather than a third copy.
export function siteUrl(): string {
  const host = process.env.NEXT_PUBLIC_SITE_HOST ?? "maw3ed.me";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

// The host to PUBLISH: sitemap, robots and any link meant to be shared or
// crawled. The apex answers 308 to www (0038), so publishing the apex
// spends a redirect on every crawl and every shared link, and search
// engines see two hosts for one page. External review, 2026-09-20.
//
// siteUrl() itself is left alone on purpose: it also builds the auth
// redirect URLs, which must match the allowlist in the Supabase dashboard
// — changing them here without changing them there breaks sign-up and
// password reset.
export function canonicalSiteUrl(): string {
  const url = siteUrl();
  return url.replace(/^https:\/\/maw3ed\.me$/, "https://www.maw3ed.me");
}
