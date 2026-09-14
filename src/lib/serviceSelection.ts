// The service choice carried from a clinic page into the booking wizard
// as ?services=id1,id2. Plain functions, free of React, so they can be
// tested directly (ENGINEERING-STANDARDS §4).

/** Largest visit the chain booking accepts (book_appointment_chain, 0027). */
export const MAX_SERVICES_PER_VISIT = 10;

export function bookHref(orgSlug: string, serviceIds: readonly string[]): string {
  const base = `/${encodeURIComponent(orgSlug)}/book`;
  if (serviceIds.length === 0) return base;
  return `${base}?services=${serviceIds.map(encodeURIComponent).join(",")}`;
}

/** Reads ?services= into ids the wizard can trust. The query string is
 *  editable by anyone, so only ids that are really this clinic's active
 *  services survive; first occurrence wins, the customer's order is kept,
 *  and the list is capped at the visit maximum. */
export function parseServiceSelection(
  raw: string | string[] | undefined,
  validIds: readonly string[]
): string[] {
  const text = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const valid = new Set(validIds);
  const out: string[] = [];
  for (const part of text.split(",")) {
    if (out.length === MAX_SERVICES_PER_VISIT) break;
    const id = part.trim();
    if (id && valid.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
