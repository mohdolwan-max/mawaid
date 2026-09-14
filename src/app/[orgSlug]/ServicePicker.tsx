"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import type { PublicService } from "@/lib/publicOrg";
import { bookHref } from "@/lib/serviceSelection";

// Owner report: "بختار الخدمة و بضغط حجز برجع اختار الخدمة مرة ثانية".
// The clinic page listed services that LOOKED selectable — .service-row
// lifts and highlights on hover — but did nothing when tapped, so
// "احجز الآن" opened the wizard empty and the customer chose everything a
// second time. Selection now lives here, and both book buttons carry it
// into the wizard as ?services=, where the wizard starts with it chosen.

type Selection = { selected: string[]; toggle: (id: string) => void };
const SelectionContext = createContext<Selection | null>(null);

export function ServiceSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);
  const value = useMemo(() => ({ selected, toggle }), [selected, toggle]);
  // No wrapper element: the sticky .org-tabs inside must keep the page
  // shell as its containing block, or position:sticky stops working.
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

function useSelection(): Selection {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("ServicePicker components must be inside ServiceSelectionProvider");
  return ctx;
}

export function SelectableServiceList({ services, lang }: { services: PublicService[]; lang: Lang }) {
  const { selected, toggle } = useSelection();

  return (
    <>
      <p className="hint" style={{ marginBottom: 10 }}>
        {t(lang, "org_pick_hint")}
      </p>
      {services.map((s) => {
        const order = selected.indexOf(s.id);
        const isOn = order >= 0;
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            aria-pressed={isOn}
            className={`service-row${isOn ? " selected" : ""}`}
            onClick={() => toggle(s.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(s.id);
              }
            }}
          >
            <div className="service-row-photo">
              {s.photo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
                <img src={s.photo_url} alt="" />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <strong>
                {isOn && <span className="pick-order">{order + 1}</span>}
                {s.name}
              </strong>
              <p className="hint">
                {s.duration_minutes} {t(lang, "minutes")}
              </p>
            </div>
            {s.price != null && (
              <span className="num">
                {s.price} {t(lang, "currency")}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

export function BookNowLink({
  orgSlug,
  className,
  children,
}: {
  orgSlug: string;
  className?: string;
  children: ReactNode;
}) {
  const { selected } = useSelection();
  return (
    <Link href={bookHref(orgSlug, selected)} className={className}>
      {children}
    </Link>
  );
}
