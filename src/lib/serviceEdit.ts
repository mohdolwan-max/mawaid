// Editing a service's name, duration and price: the rules, free of React
// and the database so they can be tested directly. The same bounds the
// add form's inputs already imply (a duration of at least 5 minutes, a
// price of zero or more, an empty price meaning "no price shown").

export const SERVICE_NAME_MAX = 80;
export const SERVICE_DURATION_MIN = 5;
export const SERVICE_DURATION_MAX = 600;
export const SERVICE_PRICE_MAX = 100000;

export type ServiceEditError = "required_field" | "service_duration_invalid" | "service_price_invalid";

export type ServiceEdit = {
  name: string;
  durationMinutes: number;
  /** null = no price, shown as "—". Never 0 by accident: 0 must be typed. */
  price: number | null;
};

/** Accepts Arabic-Indic digits and a comma decimal separator, as typed on
 *  an Arabic phone keyboard. */
function toNumber(raw: string): number {
  const western = raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٫,]/g, ".");
  if (western === "" || !/^\d+(\.\d+)?$/.test(western)) return Number.NaN;
  return Number(western);
}

export function parseServiceEdit(input: {
  name: string;
  duration: string;
  price: string;
}): ServiceEdit | { error: ServiceEditError } {
  const name = input.name.replace(/\s+/g, " ").trim();
  if (!name || [...name].length > SERVICE_NAME_MAX) return { error: "required_field" };

  const duration = toNumber(input.duration);
  if (!Number.isInteger(duration) || duration < SERVICE_DURATION_MIN || duration > SERVICE_DURATION_MAX) {
    return { error: "service_duration_invalid" };
  }

  let price: number | null = null;
  if (input.price.trim() !== "") {
    const p = toNumber(input.price);
    if (!Number.isFinite(p) || p < 0 || p > SERVICE_PRICE_MAX) return { error: "service_price_invalid" };
    price = Math.round(p * 100) / 100;
  }

  return { name, durationMinutes: duration, price };
}
