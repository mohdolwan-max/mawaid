import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { isPlatformAdmin } from "@/lib/adminServer";
import { getPublicOrg } from "@/lib/publicOrg";
import { canonicalSiteUrl } from "@/lib/siteUrl";
import { clinicQrUrl, QR_LOGO_FRACTION } from "@/lib/qr";
import { QrDownloadButton } from "./QrDownloadButton";
import { PosterPrintButton } from "./PosterPrintButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  // The PDF a browser saves is named after the page title.
  return { title: `maw3ed_qr_${slug}`, robots: { index: false, follow: false } };
}

// A clinic's QR code and its printable A5 poster (owner, 2026-10-25). For
// the clinic's own members, and for the platform admin preparing posters
// for any clinic. The poster is in Arabic whatever the dashboard language:
// it hangs in a Jordanian or Saudi reception, read by customers.
export default async function PosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/poster/${slug}`)}`);

  const [lang, admin, ctxRes] = await Promise.all([
    getLang(),
    isPlatformAdmin(),
    supabase.rpc("get_my_context").maybeSingle(),
  ]);
  const mySlug = (ctxRes.data as { org_slug?: string } | null)?.org_slug ?? null;
  if (!admin && mySlug !== slug) notFound();

  // Public details only (name, logo); a closed clinic has no page for the
  // code to open, so it gets no poster either.
  const org = await getPublicOrg(slug);
  if (!org) notFound();

  const url = clinicQrUrl(canonicalSiteUrl(), slug);
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 0,
    color: { dark: "#0d3b3b", light: "#ffffff" },
  });
  const displayLink = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\?.*$/, "");

  return (
    <div className="poster-shell">
      <div className="poster-toolbar no-print">
        <Link href={admin && mySlug !== slug ? "/admin/subscriptions" : "/dashboard"} className="btn ghost sm">
          {t(lang, "back")}
        </Link>
        <div className="toolbar">
          <QrDownloadButton lang={lang} url={url} slug={slug} />
          <PosterPrintButton lang={lang} />
        </div>
      </div>
      <p className="hint no-print" style={{ marginBottom: 12 }}>
        {t(lang, "qr_hint")}
      </p>

      <article className="poster-sheet" dir="rtl" lang="ar">
        <header className="poster-org">
          {org.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
            <img className="poster-org-logo" src={org.logo_url} alt="" />
          )}
          <h1>{org.name}</h1>
        </header>

        <p className="poster-headline">امسح الرمز لحجز موعدك</p>
        <p className="poster-sub" lang="en" dir="ltr">
          Scan to book your appointment
        </p>

        <div className="poster-qr">
          <div className="poster-qr-code" dangerouslySetInnerHTML={{ __html: svg }} />
          {/* The symbol over the middle of the code; error correction H
              restores what it covers (the tests decode it). */}
          <span className="poster-qr-logo" style={{ width: `${QR_LOGO_FRACTION * 100}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/splash-symbol.webp" alt="" />
          </span>
        </div>

        <p className="poster-link">
          أو افتح الرابط: <bdi dir="ltr">{displayLink}</bdi>
        </p>

        <footer className="poster-foot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/symbol-128.png" alt="" className="poster-foot-sym" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark-ar-teal.png" alt="موعد" className="poster-foot-word" />
          <span>احجز مواعيدك بسهولة</span>
        </footer>
      </article>
    </div>
  );
}
