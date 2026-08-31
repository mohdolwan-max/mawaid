import { t, type Lang } from "@/lib/i18n";

// Title is a qualifier, name is the identity — kept as separate columns
// and joined only for display, so "د." + "أحمد" reads as "د. أحمد" while
// either can be edited without disturbing the other.
function withTitle(title: string | null | undefined, name: string): string {
  const t2 = title?.trim();
  return t2 ? `${t2} ${name}` : name;
}

// How a staff member is shown wherever the OWNER lists one. Name first;
// an account-less person (added by name, no login) has no email to fall
// back to, and an owner who has never set a name still needs to be
// distinguishable — hence the generic last resort rather than a blank.
//
// Deliberately does NOT fall back to email on customer-facing surfaces:
// use staffPublicLabel there. The booking page used to render the
// employee's email address straight at the customer.
export function staffOwnerLabel(
  staff: { display_name?: string | null; title?: string | null; email?: string | null },
  lang: Lang
): string {
  const name = staff.display_name?.trim();
  if (name) return withTitle(staff.title, name);
  if (staff.email) return staff.email;
  return t(lang, "staff_unnamed");
}

export function staffPublicLabel(
  staff: { name?: string | null; title?: string | null },
  lang: Lang
): string {
  const name = staff.name?.trim();
  return name ? withTitle(staff.title, name) : t(lang, "staff_unnamed");
}
