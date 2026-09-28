import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { parseInvoice, type Invoice } from "@/lib/invoice";

/** The invoice of one payment, for its clinic's owner or the platform
 *  admin (get_invoice checks which). "missing" when there is no invoice
 *  the caller may see; null when it could not be read. */
// cache(): the page and its metadata (the PDF file name) ask in the same render.
export const getInvoice = cache(async (paymentId: string): Promise<Invoice | "missing" | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_invoice", { p_payment_id: paymentId });
  if (error) {
    // 22P02 = not a uuid: a mistyped link, not a failure.
    if (error.code === "22P02") return "missing";
    if (error.code === "PGRST202") console.error("get_invoice missing (0057 unapplied)");
    else console.error("get_invoice failed", error);
    return null;
  }
  if (data === null) return "missing";
  const parsed = parseInvoice(data);
  if (!parsed) console.error("get_invoice returned an unreadable payload");
  return parsed;
});
