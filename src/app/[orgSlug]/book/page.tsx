import { notFound } from "next/navigation";
import { getLang } from "@/lib/lang";
import { getPublicOrg, listPublicServices } from "@/lib/publicOrg";
import { getCustomerProfile } from "@/lib/customer";
import { BackBar } from "@/components/marketplace/BackBar";
import { parseServiceSelection } from "@/lib/serviceSelection";
import { BookingClient } from "./BookingClient";

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ services?: string | string[] }>;
}) {
  const [{ orgSlug }, { services: servicesParam }] = await Promise.all([params, searchParams]);
  const lang = await getLang();

  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const [services, customer] = await Promise.all([listPublicServices(orgSlug), getCustomerProfile()]);
  // Services already picked on the clinic page. Checked against this
  // clinic's real services, because the query string is anyone's to edit.
  const initialServiceIds = parseServiceSelection(
    servicesParam,
    services.map((s) => s.id)
  );

  return (
    <div className="public-shell">
      <BackBar href={`/${orgSlug}`} title={org.name} />
      <BookingClient
        lang={lang}
        orgSlug={orgSlug}
        services={services}
        initialServiceIds={initialServiceIds}
        defaults={
          customer
            ? { name: customer.name, phone: customer.phone, email: customer.email ?? "" }
            : null
        }
      />
    </div>
  );
}
