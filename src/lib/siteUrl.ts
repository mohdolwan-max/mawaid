// Same NEXT_PUBLIC_SITE_HOST convention already used by the booking
// confirmation email and the customer email-verification redirect
// (src/app/[orgSlug]/book/actions.ts, src/app/account/actions.ts) —
// centralized here for robots.ts/sitemap.ts rather than a third copy.
export function siteUrl(): string {
  const host = process.env.NEXT_PUBLIC_SITE_HOST ?? "mawaidy.vercel.app";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}
