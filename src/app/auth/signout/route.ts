import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// A Route Handler (unlike a Server Component render) can write cookies, so
// this is the only place an invalid/expired session cookie actually gets
// cleared — see src/lib/org.ts's requireOrgContext().
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url));
}
