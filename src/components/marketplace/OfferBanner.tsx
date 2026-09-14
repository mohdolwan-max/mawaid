"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { bannerHref, bannerImage, type ActiveBanner } from "@/lib/offers";

const ROTATE_MS = 5000;
const SWIPE_PX = 40;

// Paid offers (0045) at the top of the home page. Slides cross-fade in
// place rather than slide sideways, so nothing depends on RTL/LTR travel
// direction. Rotation pauses under a pointer, a finger or keyboard focus,
// and never runs for visitors who ask for reduced motion.
export function OfferBanner({
  banners,
  lang,
  preview = false,
}: {
  banners: ActiveBanner[];
  lang: Lang;
  /** The dashboard preview: same markup, not a link. */
  preview?: boolean;
}) {
  const count = banners.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // The list arrives in payment order, so without this the earliest payer
  // would always be the one every visitor sees first. Chosen after
  // hydration so server and client render the same first frame.
  useEffect(() => {
    if (count > 1 && !preview) setIndex(Math.floor(Math.random() * count));
  }, [count, preview]);

  useEffect(() => {
    if (count <= 1 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [count, paused]);

  if (count === 0) return null;

  const current = Math.min(index, count - 1);
  const go = (i: number) => setIndex(((i % count) + count) % count);

  return (
    <section
      className="offer-banner"
      aria-roledescription="carousel"
      aria-label={t(lang, "offer_banner_label")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={(e) => {
        touchStartX.current = e.touches[0].clientX;
        setPaused(true);
      }}
      onTouchEnd={(e) => {
        const start = touchStartX.current;
        touchStartX.current = null;
        setPaused(false);
        if (start === null || count <= 1) return;
        const dx = e.changedTouches[0].clientX - start;
        if (Math.abs(dx) < SWIPE_PX) return;
        // "Next" is a swipe toward the reading start: left in LTR, right in RTL.
        const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
        go(current + ((rtl ? dx > 0 : dx < 0) ? 1 : -1));
      }}
    >
      <div className="offer-slides">
        {banners.map((b, i) => {
          const active = i === current;
          const img = bannerImage(b);
          const className = `offer-slide${active ? " active" : ""}${img ? "" : " no-img"}`;
          const body: ReactNode = (
            <>
              {img && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
                <img className="offer-img" src={img} alt="" />
              )}
              <span className="offer-shade" />
              <span className="offer-content">
                <span className="offer-tag">{t(lang, "offer_badge")}</span>
                <strong className="offer-title">{b.title}</strong>
                <span className="offer-org">
                  {b.orgName}
                  {b.serviceName ? ` · ${b.serviceName}` : ""}
                </span>
                <span className="offer-cta">{t(lang, b.serviceId ? "offer_cta_book" : "offer_cta_view")}</span>
              </span>
            </>
          );
          return preview ? (
            <div key={b.offerId} className={className} aria-hidden={!active}>
              {body}
            </div>
          ) : (
            <Link
              key={b.offerId}
              href={bannerHref(b)}
              className={className}
              aria-hidden={!active}
              tabIndex={active ? 0 : -1}
            >
              {body}
            </Link>
          );
        })}
      </div>

      {count > 1 && (
        <div className="offer-dots">
          {banners.map((b, i) => (
            <button
              key={b.offerId}
              type="button"
              className={i === current ? "active" : ""}
              aria-label={t(lang, "offer_slide_n", { n: i + 1, total: count })}
              aria-current={i === current}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
