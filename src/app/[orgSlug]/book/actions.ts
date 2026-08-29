"use server";

import { getAvailableSlots, bookAppointment, type BookResult } from "@/lib/availability";
import { listPublicStaffForService, listPublicServices, getPublicOrg, type PublicStaff } from "@/lib/publicOrg";
import { sendBookingConfirmation } from "@/lib/email";
import { getLang } from "@/lib/lang";

export async function fetchStaffAction(orgSlug: string, serviceId: string): Promise<PublicStaff[]> {
  return listPublicStaffForService(orgSlug, serviceId);
}

export async function fetchSlotsAction(
  orgSlug: string,
  serviceId: string,
  date: string,
  staffId: string | null
): Promise<string[]> {
  return getAvailableSlots(orgSlug, serviceId, date, staffId);
}

export async function submitBookingAction(input: {
  orgSlug: string;
  serviceId: string;
  startAt: string;
  staffId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
}): Promise<BookResult> {
  const result = await bookAppointment({
    orgSlug: input.orgSlug,
    serviceId: input.serviceId,
    startAt: input.startAt,
    staffId: input.staffId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail || null,
    notes: input.notes || null,
  });

  if (result.ok && input.customerEmail) {
    // Fire-and-forget-ish: awaited so errors are logged, but a failed
    // email never fails the booking itself (see src/lib/email.ts).
    const [org, services, lang] = await Promise.all([
      getPublicOrg(input.orgSlug),
      listPublicServices(input.orgSlug),
      getLang(),
    ]);
    const service = services.find((s) => s.id === input.serviceId);
    if (org && service) {
      await sendBookingConfirmation({
        toEmail: input.customerEmail,
        toName: input.customerName,
        orgName: org.name,
        serviceName: service.name,
        startAt: input.startAt,
        timezone: org.timezone,
        lang,
        manageUrl: `https://${process.env.NEXT_PUBLIC_SITE_HOST ?? "mawaidy.vercel.app"}/${input.orgSlug}/booking/${result.cancelToken}`,
      });
    }
  }

  return result;
}
