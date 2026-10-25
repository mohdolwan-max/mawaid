import { notFound } from "next/navigation";
import { getLang } from "@/lib/lang";
import { getPublicOrg, listPublicServices } from "@/lib/publicOrg";
import { getCustomerProfile } from "@/lib/customer";
import { BackBar } from "@/components/marketplace/BackBar";
import { parseServiceSelection } from "@/lib/serviceSelection";
import { BookingClient } from "./BookingClient";
import { SourceCapture } from "@/components/marketplace/SourceCapture";
import { parseBookDate } from "@/lib/waitlist";
import { parseBookAt } from "@/lib/openTimes";
import { todayYMD } from "@/lib/date";

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ services?: string | string[]; date?: string | string[]; at?: string | string[] }>;
}) {
  const [{ orgSlug }, { services: servicesParam, date: dateParam, at: atParam }] = await Promise.all([params, searchParams]);
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
      {/* A code may also point straight at the booking page. */}
      <SourceCapture slug={orgSlug} />
      <BackBar href={`/${orgSlug}`} title={org.name} />
      <BookingClient
        lang={lang}
        orgSlug={orgSlug}
        services={services}
        timezone={org.timezone ?? "Asia/Amman"}
        orgPhone={org.phone ?? null}
        currency={org.currency}
        initialServiceIds={initialServiceIds}
        // The day a waitlist email points at (0066); a bad or past one is
        // ignored and the page starts on today.
        initialDate={parseBookDate(dateParam, todayYMD(org.timezone ?? "Asia/Amman"))}
        // The time picked in the search by free time (0069), selected when
        // the slot list still offers it.
        initialSlot={parseBookAt(atParam, parseBookDate(dateParam, todayYMD(org.timezone ?? "Asia/Amman")), org.timezone ?? "Asia/Amman")}
        defaults={
          customer
            ? { name: customer.name, phone: customer.phone, email: customer.email ?? "" }
            : null
        }
      />
    </div>
  );
}
