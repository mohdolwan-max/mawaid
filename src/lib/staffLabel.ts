import { t, type Lang } from "@/lib/i18n";

// How a staff member is shown wherever one is listed. Name first; an
// account-less person (added by name, no login) has no email to fall
// back to, and an owner who has never set a name still needs to be
// distinguishable — hence the generic last resort rather than a blank.
//
// Deliberately does NOT fall back to email on customer-facing surfaces:
// use staffPublicLabel there. The booking page used to render the
// employee's email address straight at the customer.
export function staffOwnerLabel(
  staff: { display_name?: string | null; email?: string | null },
  lang: Lang
): string {
  const name = staff.display_name?.trim();
  if (name) return name;
  if (staff.email) return staff.email;
  return t(lang, "staff_unnamed");
}

export function staffPublicLabel(name: string | null | undefined, lang: Lang): string {
  const trimmed = name?.trim();
  return trimmed || t(lang, "staff_unnamed");
}
