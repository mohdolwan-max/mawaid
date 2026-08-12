import { notFound } from "next/navigation";
import { getLang } from "@/lib/lang";
import { getPublicOrg, listPublicServices } from "@/lib/publicOrg";
import { BookingClient } from "./BookingClient";

export default async function BookPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const lang = await getLang();

  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const services = await listPublicServices(orgSlug);

  return (
    <div className="public-shell">
      <div className="public-header">
        <div>
          <h1>{org.name}</h1>
        </div>
      </div>
      <BookingClient lang={lang} orgSlug={orgSlug} services={services} />
    </div>
  );
}
