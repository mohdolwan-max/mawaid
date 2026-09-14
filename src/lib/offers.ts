import { addDaysYMD } from "@/lib/date";
import { bookHref } from "@/lib/serviceSelection";

// Offer banners (0045): the rules and arithmetic the dashboard shows
// BEFORE an order is placed. create_offer_order re-checks every one of
// them — the database is the authority — these exist so a clinic sees
// "that day is full" while choosing, not as an error after pressing pay.
// Free of React and the database so it can be tested directly.

/** Mirrors offers_title_len in 0045. */
export const OFFER_TITLE_MIN = 8;
export const OFFER_TITLE_MAX = 70;

export type OfferSetup = {
  orgName: string;
  orgSlug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string | null;
  isListed: boolean;
  /** "YYYY-MM-DD" in the offer timezone. */
  today: string;
  timezone: string;
  pricePerDayJod: number;
  slotsPerDay: number;
  maxDays: number;
  maxAdvanceDays: number;
  holdMinutes: number;
  /** Last day an offer may run: the plan and its grace must still be
   *  open (0046). null = the plan has no end. */
  lastOfferDay: string | null;
};

export type DayAvailability = {
  day: string;
  taken: number;
  /** This clinic already holds a place that day. */
  mine: boolean;
};

export type OfferState =
  | "awaiting_payment"
  | "expired"
  | "scheduled"
  | "live"
  | "ended"
  | "cancelled"
  | "removed"
  | "needs_refund";

const STATES: readonly OfferState[] = [
  "awaiting_payment",
  "expired",
  "scheduled",
  "live",
  "ended",
  "cancelled",
  "removed",
  "needs_refund",
];

export function isOfferState(v: unknown): v is OfferState {
  return typeof v === "string" && (STATES as readonly string[]).includes(v);
}

export const OFFER_STATE_TONE: Record<OfferState, "good" | "warn" | "bad" | "neutral"> = {
  live: "good",
  scheduled: "good",
  awaiting_payment: "warn",
  expired: "neutral",
  ended: "neutral",
  cancelled: "neutral",
  removed: "bad",
  needs_refund: "bad",
};

export type MyOffer = {
  id: string;
  title: string;
  serviceName: string | null;
  city: string;
  startDate: string;
  endDate: string;
  days: number;
  pricePerDayJod: number;
  totalJod: number;
  state: OfferState;
  holdExpiresAt: string;
  paidAt: string | null;
  createdAt: string;
};

export type ActiveBanner = {
  offerId: string;
  title: string;
  orgName: string;
  orgSlug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  serviceId: string | null;
  serviceName: string | null;
  servicePhotoUrl: string | null;
};

/** Collapses runs of whitespace, as create_offer_order does. */
export function normalizeOfferTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Characters as Postgres char_length counts them (code points), not
 *  UTF-16 units — an emoji is one character on both sides. */
export function offerTitleLength(raw: string): number {
  return [...normalizeOfferTitle(raw)].length;
}

/** null when either input cannot make a real price. Rounded to fils the
 *  way the database rounds the stored total. */
export function offerTotalJod(days: number, pricePerDayJod: number): number | null {
  if (!Number.isInteger(days) || days < 1) return null;
  if (!Number.isFinite(pricePerDayJod) || pricePerDayJod <= 0) return null;
  return Math.round(days * pricePerDayJod * 100) / 100;
}

export function offerEndDate(start: string, days: number): string {
  return addDaysYMD(start, days - 1);
}

export type DayStatus = "free" | "full" | "mine" | "unknown";

/** "unknown" when the day was not loaded: never shown as free. */
export function dayStatus(a: DayAvailability | undefined, slotsPerDay: number): DayStatus {
  if (!a) return "unknown";
  if (a.mine) return "mine";
  return a.taken >= slotsPerDay ? "full" : "free";
}

export function freePlaces(a: DayAvailability | undefined, slotsPerDay: number): number | null {
  if (!a) return null;
  return Math.max(0, slotsPerDay - a.taken);
}

export type OfferDraftError =
  | "offer_no_city"
  | "offer_not_listed"
  | "offer_title_length"
  | "offer_days_range"
  | "offer_start_range"
  | "offer_beyond_plan"
  | "offer_org_overlap"
  | "offer_days_full"
  | "offer_days_unknown";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** The first reason this order would be refused, or null when it can be
 *  placed. Same order of checks as create_offer_order. */
export function checkOfferDraft(
  draft: { title: string; start: string; days: number },
  setup: OfferSetup,
  availability: readonly DayAvailability[]
): OfferDraftError | null {
  if (!setup.city) return "offer_no_city";
  if (!setup.isListed) return "offer_not_listed";

  const len = offerTitleLength(draft.title);
  if (len < OFFER_TITLE_MIN || len > OFFER_TITLE_MAX) return "offer_title_length";

  if (
    !YMD.test(draft.start) ||
    draft.start < setup.today ||
    draft.start > addDaysYMD(setup.today, setup.maxAdvanceDays)
  ) {
    return "offer_start_range";
  }
  if (!Number.isInteger(draft.days) || draft.days < 1 || draft.days > setup.maxDays) {
    return "offer_days_range";
  }
  if (setup.lastOfferDay !== null && offerEndDate(draft.start, draft.days) > setup.lastOfferDay) {
    return "offer_beyond_plan";
  }

  const byDay = new Map(availability.map((a) => [a.day, a]));
  let unknown = false;
  for (let i = 0; i < draft.days; i++) {
    const status = dayStatus(byDay.get(addDaysYMD(draft.start, i)), setup.slotsPerDay);
    if (status === "mine") return "offer_org_overlap";
    if (status === "full") return "offer_days_full";
    if (status === "unknown") unknown = true;
  }
  return unknown ? "offer_days_unknown" : null;
}

/** Tapping an offer tied to a service opens booking with that service
 *  already chosen; otherwise the clinic's page. */
export function bannerHref(b: ActiveBanner): string {
  return b.serviceId ? bookHref(b.orgSlug, [b.serviceId]) : `/${encodeURIComponent(b.orgSlug)}`;
}

export function bannerImage(b: ActiveBanner): string | null {
  return b.servicePhotoUrl ?? b.coverUrl ?? null;
}
