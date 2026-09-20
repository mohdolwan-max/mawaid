// Guards against storing/rendering a "javascript:" (or other
// non-http(s)) scheme in a field an org owner controls but that later
// gets rendered as a real <a href> for anonymous visitors on the public
// booking page (org.maps_url) — otherwise a compromised or malicious
// owner account could plant a stored-XSS link that runs in every
// visitor's browser when clicked.
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// The browser uploads to the org-media bucket and then tells the server
// which URL to store, and nothing checked that URL: a tampered client
// could point a clinic cover at any third-party host, i.e. a tracking
// beacon on a public page (audit 2026-09-20). A stored media URL has to
// be this project public object path, inside this org own folder, which
// is exactly what the upload produces.
export function isOrgMediaUrl(value: string, orgId: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !orgId) return false;
  const prefix = `${base.replace(/\/+$/, "")}/storage/v1/object/public/org-media/${orgId}/`;
  return value.startsWith(prefix) && !value.includes("..");
}
