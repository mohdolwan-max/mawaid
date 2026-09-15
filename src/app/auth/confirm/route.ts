import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isEmailLinkType, resolveAuthNext } from "@/lib/authNext";

// Opens an auth email link (confirm signup, reset password, magic link,
// change email) by verifying its token_hash on the server.
//
// Owner report: the reset email arrived and its button worked, but it
// landed on the login page. The templates used {{ .ConfirmationURL }},
// which returns through /auth/callback with a PKCE code. Exchanging that
// code needs a verifier cookie from the browser that asked for the email,
// so a link opened in the Gmail app or on another device always failed.
// A token_hash verifies anywhere; this is Supabase's recommended flow for
// server-side apps.

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = resolveAuthNext(searchParams.get("next"), "/dashboard");

  if (tokenHash && isEmailLinkType(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    console.error("auth email link could not be verified", { type, code: error.code, message: error.message });
  }

  // Used, expired, or malformed: say so on the login page instead of
  // dropping the person there with no explanation.
  const login = new URL("/login", request.url);
  login.searchParams.set("link", "expired");
  return NextResponse.redirect(login);
}
