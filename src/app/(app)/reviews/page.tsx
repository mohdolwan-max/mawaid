import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import type { OrgReview } from "@/lib/types";
import { ReviewsClient } from "./ReviewsClient";

export default async function ReviewsPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  // RLS already lets any org member select their own org's reviews
  // directly (see 0008_reviews.sql's "members can view org reviews"
  // policy) — same direct-table-read pattern as the settings page.
  const { data } = await supabase
    .from("reviews")
    .select("id, rating, comment, customer_name, created_at, hidden_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "reviews_title")}</h2>
          <p>{t(ctx.lang, "reviews_sub")}</p>
        </div>
      </div>
      <ReviewsClient lang={ctx.lang} reviews={(data as OrgReview[]) ?? []} canManage={ctx.role === "owner"} />
    </div>
  );
}
