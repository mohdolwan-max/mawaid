import Link from "next/link";

// Compact page header for public pages: circular back button (arrow
// direction handled in CSS per dir) + title.
export function BackBar({ href, title }: { href: string; title: string }) {
  return (
    <div className="back-bar">
      <Link href={href} className="back-btn" aria-label="back" />
      <h1>{title}</h1>
    </div>
  );
}
