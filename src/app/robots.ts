import type { MetadataRoute } from "next";
import { canonicalSiteUrl } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Owner/staff app shell, customer account pages, and auth flows —
      // nothing here is a public marketplace page worth indexing.
      disallow: [
        "/dashboard",
        "/services",
        "/staff",
        "/bookings",
        "/reports",
        "/settings",
        "/onboarding",
        "/account",
        "/my",
        "/login",
        "/signup",
        "/forgot-password",
        "/reset-password",
        "/auth/",
      ],
    },
    sitemap: `${canonicalSiteUrl()}/sitemap.xml`,
  };
}
