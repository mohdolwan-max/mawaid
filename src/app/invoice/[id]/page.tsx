import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getInvoice } from "@/lib/invoiceServer";
import { isPlatformAdmin } from "@/lib/adminServer";
import { getMarkets } from "@/lib/marketsServer";
import { marketByCode } from "@/lib/markets";
import { PrintButton } from "@/app/admin/reports/PrintButton";
import { InvoiceDocument } from "./InvoiceDocument";

export const dynamic = "force-dynamic";

// The PDF a browser saves is named after the page title.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const inv = await getInvoice(id);
  return {
    title: inv && inv !== "missing" ? `invoice_${inv.invoiceNo}` : "invoice",
    robots: { index: false, follow: false },
  };
}

// One page for both readers: the clinic that paid (from its billing page)
// and the platform admin (from sales). get_invoice (0057) decides who may
// read it, and anyone else gets the ordinary not-found page.
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invoice/${id}`)}`);

  const [lang, inv, admin, markets] = await Promise.all([getLang(), getInvoice(id), isPlatformAdmin(), getMarkets()]);
  if (inv === "missing") notFound();

  const back = admin ? "/admin/sales" : "/billing";
  const toolbar = (
    <div className="inv-toolbar no-print">
      <Link href={back} className="btn ghost sm">
        {t(lang, "invoice_back")}
      </Link>
      {inv && <PrintButton lang={lang} />}
    </div>
  );

  if (!inv) {
    return (
      <div className="inv-shell">
        {toolbar}
        <div className="empty">{t(lang, "invoice_load_failed")}</div>
      </div>
    );
  }

  const countryName = (code: string | null) => marketByCode(markets, code)?.nameAr ?? "";

  return (
    <div className="inv-shell">
      {toolbar}
      <InvoiceDocument inv={inv} countryName={countryName} />
    </div>
  );
}
