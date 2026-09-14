import { NextResponse, type NextRequest } from "next/server";
import { getPaymentProvider, paymentsSecret } from "@/lib/payments";

// Which payment settings the RUNNING deployment actually sees. Added after
// the keys were entered on Vercel and the webhook still answered
// "payments_not_configured", with no way to tell from outside which of
// five variables was missing, misspelt, scoped to the wrong environment,
// or simply not in the build that was serving.
//
// Reports presence only, never a value, and only to a caller holding
// CRON_SECRET. The deployed commit comes from Vercel's own system variable.

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const providerId = process.env.PAYMENT_PROVIDER?.trim() ?? "";
  const profileId = process.env.PAYTABS_PROFILE_ID?.trim() ?? "";
  let baseHost: string | null = null;
  try {
    baseHost = process.env.PAYTABS_BASE_URL ? new URL(process.env.PAYTABS_BASE_URL.trim()).host : null;
  } catch {
    baseHost = "unparseable";
  }

  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? null,
    PAYMENT_PROVIDER: providerId ? providerId : "missing",
    PAYTABS_PROFILE_ID: profileId === "" ? "missing" : /^\d+$/.test(profileId) ? "ok" : "not a number",
    PAYTABS_SERVER_KEY: process.env.PAYTABS_SERVER_KEY?.trim() ? "present" : "missing",
    PAYTABS_BASE_URL: baseHost ?? "default (Jordan)",
    PAYMENTS_SECRET: paymentsSecret() ? "present" : "missing",
    adapter_loaded: getPaymentProvider() !== null,
  });
}
