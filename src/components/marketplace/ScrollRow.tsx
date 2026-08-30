"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Wraps any horizontally-scrolling row (category chips, card rows) with
// prev/next arrow buttons. Touch/trackpad users can already swipe, but a
// plain desktop mouse wheel only scrolls vertically — without these there
// was no way at all to reach content past the fold on desktop.
//
// Arrows and the edge fade are driven by real scroll state, not rendered
// unconditionally: a row holding a single card (a city with one clinic)
// has nothing to scroll, and showing a floating arrow on top of it plus
// fading both its edges made the card look chopped off.
//
// Direction-aware throughout: scrollBy's sign flips per call on the row's
// computed direction, the arrow glyphs are mirrored in RTL via CSS, and
// the fade side is swapped by a [dir="rtl"] rule in globals.css.
export function ScrollRow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // scrollLeft counts up in LTR and down (negative) in RTL, so the
    // distance already travelled from the start is the magnitude either
    // way. 1px of slack absorbs sub-pixel layout rounding.
    const travelled = Math.abs(el.scrollLeft);
    setCanBack(max > 1 && travelled > 1);
    setCanForward(max > 1 && travelled < max - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    // The row's own size AND its children's can change after mount (font
    // swap, cover images decoding), and either changes what's scrollable.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [sync, children]);

  function scroll(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: (rtl ? -1 : 1) * dir * 280, behavior: "smooth" });
  }

  const fade =
    canBack && canForward
      ? "scroll-fade-both"
      : canBack
        ? "scroll-fade-start"
        : canForward
          ? "scroll-fade-end"
          : "";

  return (
    <div className="scroll-row-wrap">
      {canBack && (
        <button
          type="button"
          className="scroll-arrow start"
          aria-label="Scroll back"
          onClick={() => scroll(-1)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
      )}
      <div className={fade ? `${className} ${fade}` : className} ref={ref}>
        {children}
      </div>
      {canForward && (
        <button
          type="button"
          className="scroll-arrow end"
          aria-label="Scroll forward"
          onClick={() => scroll(1)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
