import type { Metadata, Viewport } from "next";
import { Cairo, Poppins } from "next/font/google";
import { getLang } from "@/lib/lang";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800", "900"],
});

// Brand kit pairs Poppins (English) with Cairo (Arabic) — applied via
// :lang(en) in globals.css so it only takes over on English pages,
// Cairo stays the default/Arabic font.
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  // www, not the apex: the apex answers 308 and some link-preview
  // crawlers refuse to follow redirects when fetching og:image —
  // absolute URLs built from here must serve 200 directly.
  metadataBase: new URL("https://www.maw3ed.me"),
  title: "موعد — حجوزات العيادات ومراكز التجميل | Maw3ed",
  description: "منصة حجوزات إلكترونية للعيادات ومراكز التجميل — بدون تطبيق يثبته عميلك.",
  // WhatsApp is the primary share channel for a local-business app: this
  // plus src/app/opengraph-image.png turns a bare text link into a
  // branded card. Clinic pages override it with their own cover photo.
  openGraph: {
    title: "موعد — حجوزات العيادات ومراكز التجميل",
    description: "احجز موعدك في ثوانٍ — عيادات ومراكز تجميل موثوقة، بأوقات متاحة فعلياً.",
    siteName: "موعد",
    type: "website",
    locale: "ar_JO",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "موعد",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#146C63",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();

  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`${cairo.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
