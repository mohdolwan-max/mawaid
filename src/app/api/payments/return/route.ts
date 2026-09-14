import { NextResponse, type NextRequest } from "next/server";

// Where the gateway sends the clinic's browser back after paying. PayTabs
// returns with a cross-site form POST, which a page cannot receive and
// which carries no session cookie (SameSite=Lax). So this only bounces the
// browser, with a 303 GET, to the signed-in result page.
//
// Nothing posted here is trusted: the result page reads the payment from
// the database, where only the verified webhook (../webhook) can mark it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bounce(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("payment") ?? "";
  const target = new URL("/billing/return", request.url);
  if (UUID.test(id)) target.searchParams.set("payment", id);
  return NextResponse.redirect(target, 303);
}

export function POST(request: NextRequest) {
  return bounce(request);
}

export function GET(request: NextRequest) {
  return bounce(request);
}
