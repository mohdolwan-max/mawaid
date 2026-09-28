import { SplashIntro } from "@/components/SplashIntro";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
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

// Runs before first paint so SplashIntro's server-rendered overlay is
// decided without a flash: shown once per session in the installed app,
// hidden after that, and forced on by "#splash" for previewing in a browser.
const SPLASH_GATE = `(function(){var d=document.documentElement;try{
if(location.hash==="#splash"){d.classList.add("splash-preview");return;}
if(!matchMedia("(display-mode: standalone)").matches)return;
if(sessionStorage.getItem("maw3ed_splash")){d.classList.add("splash-seen");return;}
sessionStorage.setItem("maw3ed_splash","1");
}catch(e){}})();`;

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
    // suppressHydrationWarning: SPLASH_GATE adds a class to <html> before
    // React hydrates, which would otherwise be reported as a mismatch.
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={`${cairo.variable} ${poppins.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_GATE }} />
        {/* Only the installed app shows the intro, so only it pays for
            these; a browser tab skips the preload. */}
        <link rel="preload" as="image" href="/brand/splash-symbol.webp" media="(display-mode: standalone)" />
        <link rel="preload" as="image" href="/brand/wordmark-ar-320.png" media="(display-mode: standalone)" />
      </head>
      <body>
        <SplashIntro />
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
