// Where an auth email link sends the user after it is verified. Free of
// React and Next so it can be tested directly.
//
// The email templates pass Supabase's {{ .RedirectTo }} as `next`. That
// is whatever the app asked for when it sent the email: a full URL such
// as https://maw3ed.me/auth/callback?next=/onboarding. Only a same-site
// path ever comes out of this, so a crafted link cannot turn
// /auth/confirm into an open redirect.

const OUR_HOSTS = new Set(["maw3ed.me", "www.maw3ed.me", "mawaidy.vercel.app", "localhost", "127.0.0.1"]);

function samePath(v: string): string | null {
  // "/x" but not "//host" or "/\host", which browsers treat as another site.
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  return v;
}

export function resolveAuthNext(raw: string | null | undefined, fallback: string): string {
  const value = (raw ?? "").trim();
  if (!value) return fallback;

  const direct = samePath(value);
  let path: string | null = direct;

  if (!direct) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return fallback;
    }
    if (!OUR_HOSTS.has(url.hostname)) return fallback;
    path = url.pathname + url.search;
  }

  if (!path) return fallback;

  // The app's old links went through /auth/callback?next=...; the real
  // destination is that inner `next`, checked by the same rules.
  const parsed = new URL(path, "https://placeholder.invalid");
  if (parsed.pathname === "/auth/callback" || parsed.pathname === "/auth/confirm") {
    const inner = parsed.searchParams.get("next");
    const innerPath = inner ? samePath(inner) : null;
    return innerPath ?? fallback;
  }
  return path;
}

/** The email link types Supabase sends that /auth/confirm accepts. */
export const EMAIL_LINK_TYPES = ["email", "signup", "recovery", "magiclink", "email_change", "invite"] as const;
export type EmailLinkType = (typeof EMAIL_LINK_TYPES)[number];

export function isEmailLinkType(v: unknown): v is EmailLinkType {
  return typeof v === "string" && (EMAIL_LINK_TYPES as readonly string[]).includes(v);
}
