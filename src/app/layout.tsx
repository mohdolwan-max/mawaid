import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import { getLang } from "@/lib/lang";
import "./globals.css";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "مواعيد — حجوزات العيادات ومراكز التجميل | Mawaid",
  description: "منصة حجوزات إلكترونية للعيادات ومراكز التجميل — بدون تطبيق يثبته عميلك.",
};

export const viewport: Viewport = {
  themeColor: "#0f6e5c",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();

  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={cairo.variable}>
      <body>{children}</body>
    </html>
  );
}
