import { requireOrgContext } from "@/lib/org";
import { t } from "@/lib/i18n";
import { PaymentReturn } from "./PaymentReturn";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const [ctx, { payment }] = await Promise.all([requireOrgContext(), searchParams]);
  const lang = ctx.lang;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(lang, "billing_return_title")}</h2>
        </div>
      </div>
      {payment && UUID.test(payment) ? (
        <PaymentReturn lang={lang} paymentId={payment} timezone={ctx.timezone} />
      ) : (
        <div className="empty">{t(lang, "billing_return_unknown")}</div>
      )}
    </div>
  );
}
