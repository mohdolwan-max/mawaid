"use client";

import { useState, useTransition } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { OrgReview } from "@/lib/types";
import { hideReview, unhideReview } from "./actions";
import { intlLocale } from "@/lib/date";

export function ReviewsClient({
  lang,
  reviews,
  canManage,
}: {
  lang: Lang;
  reviews: OrgReview[];
  canManage: boolean;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(review: OrgReview) {
    setPendingId(review.id);
    startTransition(async () => {
      try {
        if (review.hidden_at) await unhideReview(review.id);
        else await hideReview(review.id);
      } finally {
        setPendingId(null);
      }
    });
  }

  if (reviews.length === 0) {
    return <div className="empty">{t(lang, "reviews_empty")}</div>;
  }

  return (
    <div className="card">
      {reviews.map((r) => (
        <div key={r.id} className="review-row">
          <div className="rv-head">
            <span className="rv-name">{r.customer_name}</span>
            <span className="stars readonly" aria-label={`${r.rating}/5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className={n <= r.rating ? "" : "off"}>
                  ★
                </span>
              ))}
            </span>
          </div>
          {r.comment && <p>{r.comment}</p>}
          <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 6 }}>
            <span className="rv-date">
              {new Date(r.created_at).toLocaleDateString(intlLocale(lang), {
                dateStyle: "medium",
              })}
              {r.hidden_at && <span className="chip warn" style={{ marginInlineStart: 8 }}>{t(lang, "review_hidden_badge")}</span>}
            </span>
            {canManage && (
              <button
                type="button"
                className="btn ghost sm"
                disabled={pendingId === r.id}
                onClick={() => toggle(r)}
              >
                {t(lang, r.hidden_at ? "review_unhide_cta" : "review_hide_cta")}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
