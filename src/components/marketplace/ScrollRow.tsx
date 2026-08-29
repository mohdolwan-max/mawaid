"use client";

import { useRef, type ReactNode } from "react";

// Wraps any horizontally-scrolling row (category chips, card rows) with
// prev/next arrow buttons. Touch/trackpad users can already swipe, but
// a plain desktop mouse wheel only scrolls vertically — without these
// there was no way at all to reach content past the fold on desktop.
// Direction-aware: scrollBy's sign flips per-call based on the row's
// actual computed direction, and the icons themselves are mirrored in
// RTL via CSS (see .scroll-arrow svg in globals.css), so "forward"
// always visually points toward more content in either language.
export function ScrollRow({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  function scroll(dir: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: (rtl ? -1 : 1) * dir * 280, behavior: "smooth" });
  }

  return (
    <div className="scroll-row-wrap">
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
      <div className={className} ref={ref}>
        {children}
      </div>
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
    </div>
  );
}
