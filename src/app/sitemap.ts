import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/siteUrl";
import { listDirectoryOrgs } from "@/lib/directoryServer";

// list_directory_orgs already only returns is_listed=true, non-deleted
// orgs (see 0006_directory.sql) — exactly the set worth indexing. No
// city/category filter here means every listed org across every city,
// not just one city's page.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const orgs = await listDirectoryOrgs({ limit: 1000 });

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/search`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/partners`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];

  const orgRoutes: MetadataRoute.Sitemap = orgs.map((org) => ({
    url: `${base}/${org.slug}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return [...staticRoutes, ...orgRoutes];
}
