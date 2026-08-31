import Link from "next/link";
import type { Metadata } from "next";
import { getLang } from "@/lib/lang";
import { t, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return {
    title: `${t(lang, "pt_title")} | ${t(lang, "brand")}`,
    description: t(lang, "pt_sub"),
  };
}

// The page that has to sell a monthly subscription, so it argues the case
// rather than just linking to signup: what the owner gets, how long it
// takes to set up, and what it costs, with the price stated plainly
// instead of hidden behind a "contact us".
export default async function PartnersPage() {
  const lang = await getLang();
  const host = process.env.NEXT_PUBLIC_SITE_HOST ?? "mawaidy.vercel.app";

  const features: [TKey, TKey][] = [
    ["pt_f1_t", "pt_f1_b"],
    ["pt_f2_t", "pt_f2_b"],
    ["pt_f3_t", "pt_f3_b"],
    ["pt_f4_t", "pt_f4_b"],
    ["pt_f5_t", "pt_f5_b"],
    ["pt_f6_t", "pt_f6_b"],
    ["pt_f7_t", "pt_f7_b"],
    ["pt_f8_t", "pt_f8_b"],
  ];

  const steps: [TKey, TKey][] = [
    ["pt_s1_t", "pt_s1_b"],
    ["pt_s2_t", "pt_s2_b"],
    ["pt_s3_t", "pt_s3_b"],
  ];

  const included: TKey[] = ["pt_price_i1", "pt_price_i2", "pt_price_i3", "pt_price_i4"];

  return (
    <div className="pt">
      <header className="pt-hero">
        <span className="pt-eyebrow">{t(lang, "pt_eyebrow")}</span>
        <h1>{t(lang, "pt_title")}</h1>
        <p className="pt-lede">{t(lang, "pt_sub")}</p>
        <div className="pt-cta-row">
          <Link href="/signup" className="btn pt-cta">
            {t(lang, "pt_cta")}
          </Link>
          <span className="pt-cta-note">{t(lang, "pt_cta_note")}</span>
        </div>
        <p className="hint">
          {t(lang, "pt_have_account")}{" "}
          <Link href="/login">{t(lang, "login_title")}</Link>
        </p>

        {/* The single most concrete thing the product does: turns the
            centre into a link. Showing it beats describing it. */}
        <div className="pt-link">
          <span className="pt-link-label">{t(lang, "pt_link_title")}</span>
          <code dir="ltr">{host}/your-clinic</code>
          <span className="hint">{t(lang, "pt_link_body")}</span>
        </div>
      </header>

      <section className="pt-section">
        <h2>{t(lang, "pt_features_title")}</h2>
        <div className="pt-grid">
          {features.map(([title, body]) => (
            <div key={title} className="pt-feat">
              <strong>{t(lang, title)}</strong>
              <p>{t(lang, body)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pt-section">
        <h2>{t(lang, "pt_how_title")}</h2>
        <ol className="pt-steps">
          {steps.map(([title, body], i) => (
            <li key={title}>
              <span className="pt-step-n">{(i + 1).toLocaleString(intlLocale(lang))}</span>
              <div>
                <strong>{t(lang, title)}</strong>
                <p>{t(lang, body)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="pt-section">
        <h2>{t(lang, "pt_price_title")}</h2>
        <div className="pt-price">
          <div className="pt-price-head">
            <span className="pt-free">{t(lang, "pt_price_free")}</span>
            <p className="pt-then">
              {t(lang, "pt_price_then")}{" "}
              <strong className="pt-amount">{t(lang, "pt_price_amount")}</strong>{" "}
              <span>{t(lang, "pt_price_period")}</span>
            </p>
          </div>
          <ul className="pt-included">
            {included.map((k) => (
              <li key={k}>{t(lang, k)}</li>
            ))}
          </ul>
          <Link href="/signup" className="btn block">
            {t(lang, "pt_cta")}
          </Link>
          <p className="hint pt-price-note">{t(lang, "pt_price_note")}</p>
        </div>
      </section>

      <section className="pt-final">
        <h2>{t(lang, "pt_final_title")}</h2>
        <p>{t(lang, "pt_final_sub")}</p>
        <Link href="/signup" className="btn pt-cta">
          {t(lang, "pt_cta")}
        </Link>
      </section>

      <footer className="pt-foot">
        <Link href="/">{t(lang, "brand")}</Link>
        <span>·</span>
        <Link href="/privacy">{t(lang, "footer_privacy")}</Link>
        <span>·</span>
        <Link href="/terms">{t(lang, "footer_terms")}</Link>
      </footer>
    </div>
  );
}
