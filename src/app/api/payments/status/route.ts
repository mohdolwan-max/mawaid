import { NextResponse, type NextRequest } from "next/server";
import { getPaymentProvider, paymentsSecret } from "@/lib/payments";
import { paytabsConfigReport } from "@/lib/payments/paytabs";
import { bearerOk } from "@/lib/cronAuth";

// Which payment settings the RUNNING deployment actually sees. Added after
// the keys were entered on Vercel and the webhook still answered
// "payments_not_configured", with no way to tell from outside which of
// five variables was missing, misspelt, scoped to the wrong environment,
// or simply not in the build that was serving.
//
// Reports presence only, never a value, and only to a caller holding
// CRON_SECRET. The deployed commit comes from Vercel's own system variable.
// One gateway account per country (0056), each reported on its own.

export const dynamic = "force-dynamic";

const COUNTRIES = ["JO", "SA"];

export function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!bearerOk(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const providerId = process.env.PAYMENT_PROVIDER?.trim() ?? "";
  const countries = Object.fromEntries(
    COUNTRIES.map((cc) => [cc, { ...paytabsConfigReport(cc), adapter_loaded: getPaymentProvider(cc) !== null }])
  );

  return NextResponse.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    environment: process.env.VERCEL_ENV ?? null,
    PAYMENT_PROVIDER: providerId ? providerId : "missing",
    PAYMENTS_SECRET: paymentsSecret() ? "present" : "missing",
    countries,
  });
}
