// Small monoline icon set (stroke = currentColor) replacing the emoji
// used across the app previously — plain glyphs read inconsistently
// across platforms/fonts and clash with the brand kit's clean look.
// Every icon shares the same 24x24 viewBox/stroke weight so they drop
// in at any size via font-size-independent width/height props.

type IconProps = { size?: number; className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SearchIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function CalendarIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </svg>
  );
}

export function UserIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.6-3.8 5-5.6 7.5-5.6s5.9 1.8 7.5 5.6" />
    </svg>
  );
}

export function HomeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <path d="M4 11.5L12 4l8 7.5" />
      <path d="M6 10v9.5h12V10" />
    </svg>
  );
}

export function PinIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <path d="M12 21s7-6.3 7-11.5A7 7 0 0 0 5 9.5C5 14.7 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </svg>
  );
}

export function LinkIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <path d="M9.5 14.5l5-5" />
      <path d="M11 8l1.3-1.3a3.6 3.6 0 0 1 5.1 5.1L16 13" />
      <path d="M13 16l-1.3 1.3a3.6 3.6 0 0 1-5.1-5.1L8 11" />
    </svg>
  );
}

export function ClockIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function MenuIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

export function BellIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" />
      <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

// Generic fallback for any directory category without its own photo.
export function BuildingIcon({ size = 26, className }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} aria-hidden="true">
      <rect x="5" y="4" width="14" height="16" rx="1.5" />
      <path d="M9 20v-3h6v3M9 8h.01M9 11.5h.01M9 15h.01M15 8h.01M15 11.5h.01M15 15h.01" />
    </svg>
  );
}

// The brand mark itself — two figures joining into an M around a 10:10
// clock, from the owner's vector (brand kit, teal iteration). Unlike the
// monoline set above it carries its own colours: it is the identity, not
// an interface glyph, and must render identically everywhere.
export function BrandMark({ size = 26, className }: IconProps) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bm-l" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#D4F2E8" /><stop offset="1" stopColor="#49B69F" />
        </linearGradient>
        <linearGradient id="bm-r" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#55C5B2" /><stop offset="1" stopColor="#006356" />
        </linearGradient>
      </defs>
      <circle cx="255" cy="175" r="66" fill="url(#bm-l)" />
      <circle cx="769" cy="175" r="66" fill="url(#bm-r)" />
      <rect x="175" y="310" width="130" height="470" rx="65" fill="url(#bm-l)" />
      <rect x="719" y="310" width="130" height="470" rx="65" fill="url(#bm-r)" />
      <path d="M240 330L500 555" fill="none" stroke="url(#bm-l)" strokeWidth="132" strokeLinecap="round" />
      <path d="M784 330L524 555" fill="none" stroke="url(#bm-r)" strokeWidth="132" strokeLinecap="round" />
      <circle cx="512" cy="665" r="190" fill="#7FD2BD" />
      <circle cx="512" cy="665" r="163" fill="#fff" />
      <g stroke="#006356" strokeWidth="16" strokeLinecap="round">
        <path d="M512 535v30" /><path d="M512 765v30" />
        <path d="M382 665h30" /><path d="M612 665h30" />
      </g>
      <g stroke="#006356" strokeLinecap="round">
        <path d="M512 665 L443 615" strokeWidth="22" />
        <path d="M512 665 L590 620" strokeWidth="18" />
      </g>
      <circle cx="512" cy="665" r="28" fill="#7FD2BD" />
      <circle cx="512" cy="665" r="12" fill="#fff" />
    </svg>
  );
}
