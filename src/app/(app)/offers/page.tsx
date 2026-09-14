import Link from "next/link";
import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { cityLabel } from "@/lib/directory";
import { getOfferAvailability, getOfferSetup, listMyOffers } from "@/lib/offersServer";
import { paymentsReady } from "@/lib/payments";
import { OffersClient, type OfferServiceOption } from "./OffersClient";

export default async function OffersPage() {
  const ctx = await requireOrgContext();
  const lang = ctx.lang;

  const head = (
    <div className="page-head">
      <div>
        <h2>{t(lang, "offers_title")}</h2>
        <p>{t(lang, "offers_sub")}</p>
      </div>
    </div>
  );

  // Buying is the owner's decision, like the plan (0043).
  if (ctx.role !== "owner") {
    return (
      <div>
        {head}
        <div className="empty">{t(lang, "offer_owner_only")}</div>
      </div>
    );
  }

  const supabase = await createClient();
  const [setup, availability, offers, servicesRes] = await Promise.all([
    getOfferSetup(),
    getOfferAvailability(),
    listMyOffers(),
    supabase
      .from("services")
      .select("id, name, photo_url")
      .eq("org_id", ctx.orgId)
      .eq("active", true)
      .order("sort_order")
      .order("created_at"),
  ]);

  // Without the price or the free days there is nothing honest to show.
  // Services and past orders degrade on their own (null, said on screen).
  if (!setup || !availability) {
    return (
      <div>
        {head}
        <div className="empty">{t(lang, "offer_setup_failed")}</div>
      </div>
    );
  }

  if (!setup.city || !setup.isListed) {
    return (
      <div>
        {head}
        <div className="card">
          <p>{t(lang, setup.city ? "offer_not_listed" : "offer_no_city")}</p>
          <Link href="/settings" className="btn" style={{ marginTop: 10 }}>
            {t(lang, "offer_open_settings")}
          </Link>
        </div>
      </div>
    );
  }

  if (servicesRes.error) console.error("offers page services failed", servicesRes.error);

  return (
    <div>
      {head}
      <OffersClient
        lang={lang}
        setup={setup}
        availability={availability}
        offers={offers}
        services={servicesRes.error ? null : ((servicesRes.data as OfferServiceOption[]) ?? [])}
        cityName={cityLabel(setup.city, lang)}
        paymentReady={paymentsReady()}
      />
    </div>
  );
}
