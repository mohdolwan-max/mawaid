"use client";

import { useState } from "react";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { submitReviewAction } from "./actions";

export function ReviewForm({ lang, token }: { lang: Lang; token: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  if (done) {
    return <p className="chip good">{t(lang, "review_thanks")}</p>;
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (rating < 1) return;
        setPending(true);
        setError(null);
        const result = await submitReviewAction(token, rating, comment);
        setPending(false);
        if (!result.ok) {
          setError(result.error as TKey);
          return;
        }
        setDone(true);
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: 8 }}>{t(lang, "review_form_title")}</p>
      <div className="stars" role="radiogroup" aria-label={t(lang, "review_form_title")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={n <= rating ? "on" : ""}
            aria-label={String(n)}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="rv_comment">{t(lang, "review_comment")}</label>
        <textarea id="rv_comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      {error && <p className="error-text">{t(lang, error)}</p>}
      <button type="submit" className="btn" disabled={pending || rating < 1}>
        {pending ? t(lang, "loading") : t(lang, "review_submit")}
      </button>
    </form>
  );
}
