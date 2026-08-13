import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles the redirect from a Supabase email-confirmation or magic-link
// email, exchanging the one-time code for a session cookie.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Only same-site paths — never a full URL — to keep this from becoming
  // an open redirect.
  const rawNext = searchParams.get("next") ?? "/onboarding";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/onboarding";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
