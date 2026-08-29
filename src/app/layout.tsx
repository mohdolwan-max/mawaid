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
  title: "موعد — حجوزات العيادات ومراكز التجميل | Maw3ed",
  description: "منصة حجوزات إلكترونية للعيادات ومراكز التجميل — بدون تطبيق يثبته عميلك.",
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
