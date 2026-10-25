// The clinic's user guide (roadmap item 14): one short section per part of
// the dashboard, in the words its screens use, each pointing at its page.
// Kept here, not in i18n, because it is prose rather than labels; both
// languages side by side so they are edited together.

import type { Lang } from "@/lib/i18n";

export type GuideSection = {
  id: string;
  href: string;
  title: Record<Lang, string>;
  points: Record<Lang, string[]>;
};

export const GUIDE: GuideSection[] = [
  {
    id: "start",
    href: "/services",
    title: { ar: "البداية: جهّز عيادتك", en: "Getting started" },
    points: {
      ar: [
        "من «الخدمات» أضف خدماتك بمدة كل خدمة وسعرها.",
        "من «الموظفون» أضف من يقدّم الخدمات، وحدّد ساعات كل منهم إن اختلفت عن ساعات العيادة.",
        "من «الإعدادات» حدّد ساعات العمل وقواعد الحجز: أقل مدة قبل الموعد، وأبعد مدة يحجز فيها الزبون مسبقاً، والفاصل بين المواعيد.",
        "انسخ «رابط الحجز العام» من «الرئيسية» وضعه في حساباتك، ومن زر «رمز QR» اطبع ملصقاً لمكتب الاستقبال.",
      ],
      en: [
        "In Services, add your services with their duration and price.",
        "In Staff, add who performs them, with their own hours if they differ from the clinic's.",
        "In Settings, set opening hours and booking rules: minimum notice, how far ahead customers may book, and the time between slots.",
        "Copy your page link from the Dashboard into your profiles, and print the QR poster for reception.",
      ],
    },
  },
  {
    id: "bookings",
    href: "/bookings",
    title: { ar: "الحجوزات والتقويم", en: "Bookings and calendar" },
    points: {
      ar: [
        "«إضافة حجز يدوي» في صفحة الحجوزات لمن يتصل أو يحضر، ويعرض الأوقات المتاحة فعلاً.",
        "اختر «تكرار هذا الموعد» لحجز سلسلة، مثل جلسة كل أسبوعين ست مرات، وتظهر كل المواعيد للمراجعة قبل الحجز.",
        "علّم الموعد «مكتمل» أو «لم يحضر» أو ألغه من الحجوزات أو من نافذة الموعد في التقويم. ومن التقويم تستطيع نقل الموعد إلى وقت آخر.",
      ],
      en: [
        "Use Manual booking on the Bookings page for calls and walk-ins; it offers only times that are really free.",
        "Tick Repeat this appointment to book a series, such as every two weeks six times; every date is shown for review first.",
        "Mark a visit Completed or No-show, or cancel it, from Bookings or from the appointment in the Calendar, where you can also move it.",
      ],
    },
  },
  {
    id: "customers",
    href: "/customers",
    title: { ar: "الزبائن", en: "Customers" },
    points: {
      ar: [
        "كل من حجز لديك له ملف: زياراته، ومرات غيابه، وقيمة زياراته، وملاحظاتك ووسومك الخاصة.",
        "ابحث بالاسم أو بجزء من الرقم أو بالوسم، وراسل الزبون عبر واتساب أو احجز له مباشرة من ملفه.",
        "من «استيراد زبائن» أدخل قائمتك القديمة من Excel أو ملف CSV، وتراجع كل سطر قبل الحفظ.",
      ],
      en: [
        "Everyone who booked has a file: visits, no-shows, value, and your private notes and tags.",
        "Search by name, part of the number or tag; message the customer on WhatsApp or book for them from their file.",
        "Import customers brings in your old list from Excel or a CSV file, every line reviewed before saving.",
      ],
    },
  },
  {
    id: "packages",
    href: "/services",
    title: { ar: "باقات الجلسات", en: "Session packages" },
    points: {
      ar: [
        "أنشئ الباقة في «الخدمات»: خدمة واحدة، وعدد جلسات، وسعر، ومدة صلاحية إن أردت.",
        "بِع الباقة من ملف الزبون، فتُخصم جلسة تلقائياً كلما علّمت زيارة لتلك الخدمة «مكتملة».",
        "تستطيع خصم زيارة لم يحضرها الزبون يدوياً، أو إخراج زيارة من الباقة، من سجل زيارات الزبون.",
      ],
      en: [
        "Create a package in Services: one service, a number of sessions, a price and, if you like, a validity.",
        "Sell it from the customer's file; a session is drawn each time a visit of that service is marked Completed.",
        "From the customer's visit history you can draw a missed visit by hand, or take a visit off the package.",
      ],
    },
  },
  {
    id: "waitlist",
    href: "/waitlist",
    title: { ar: "قائمة الانتظار", en: "Waitlist" },
    points: {
      ar: [
        "حين لا يجد الزبون وقتاً في اليوم الذي يريده يستطيع ترك اسمه ورقمه.",
        "عند إلغاء موعد في ذلك اليوم يُبلَّغ بالبريد إن تركه، وتظهر له في الصفحة الأوقات المتاحة الآن مع زر واتساب للتواصل.",
      ],
      en: [
        "When a customer finds no time on the day they want, they can leave their name and number.",
        "When a booking that day is cancelled they are emailed if they left an email; the page shows what is free now, with a WhatsApp button.",
      ],
    },
  },
  {
    id: "rooms",
    href: "/services",
    title: { ar: "الغرف والأجهزة", en: "Rooms and devices" },
    points: {
      ar: [
        "إن كان أكثر من أخصائي يتشارك جهازاً أو غرفة فأضفه في «الخدمات» وحدّد الخدمات التي تحتاجه.",
        "لن يُعرض وقت يكون فيه الجهاز مشغولاً، وإن كان لديك جهازان متماثلان فاكتب العدد ٢.",
      ],
      en: [
        "If specialists share a device or room, add it in Services and tick the services that need it.",
        "No time is offered while it is in use; for two identical devices enter 2.",
      ],
    },
  },
  {
    id: "reports",
    href: "/reports",
    title: { ar: "التقارير", en: "Reports" },
    points: {
      ar: [
        "اختر الفترة لترى الزيارات ونسبة عدم الحضور وقيمة الزيارات المكتملة حسب الخدمة والأخصائي.",
        "«مبيعات الباقات» هي ما دُفع يوم البيع، وجلسة الباقة تُحسب في قيمة الزيارات بحصتها من سعرها.",
        "«مصادر الحجوزات» تبيّن كم حجزاً جاء من رمز QR ومن روابطك في Google وInstagram وغيرهما.",
      ],
      en: [
        "Pick a period to see visits, the no-show rate and the value of completed visits by service and specialist.",
        "Package sales are what was paid on the day of sale; a package session counts in visit value at its share of the price.",
        "Where bookings came from shows how many came from your QR code and your Google, Instagram and other links.",
      ],
    },
  },
  {
    id: "links",
    href: "/dashboard",
    title: { ar: "روابط الحجز ورمز QR", en: "Booking links and QR code" },
    points: {
      ar: [
        "في «الرئيسية» قسم «روابط الحجز» فيه رابط مستقل لكل من Google وInstagram وFacebook وTikTok وواتساب، مع شرح مكان لصقه.",
        "استخدم الرابط المخصص لكل مكان لتعرف من التقارير أين جاء كل حجز.",
      ],
      en: [
        "On the Dashboard, Booking links has one link each for Google, Instagram, Facebook, TikTok and WhatsApp, with where to paste it.",
        "Use each place's own link so the reports can tell where every booking came from.",
      ],
    },
  },
  {
    id: "phone-calendar",
    href: "/calendar",
    title: { ar: "مواعيدك في تقويم الهاتف", en: "Appointments in your phone's calendar" },
    points: {
      ar: [
        "في صفحة التقويم اختر «أضف مواعيدك إلى تقويم هاتفك»، ثم «إضافة إلى تقويم Google» أو «إضافة إلى تقويم iPhone».",
        "الرابط خاص بك فلا تشاركه، ويُحدَّث كل بضع ساعات، فأحدث الحجوزات تجدها دائماً في التطبيق.",
      ],
      en: [
        "On the Calendar page choose Add your appointments to your phone's calendar, then Google or iPhone.",
        "The link is private, so do not share it; it refreshes every few hours, so the latest bookings are always in the app.",
      ],
    },
  },
  {
    id: "branches",
    href: "/settings",
    title: { ar: "الفروع", en: "Branches" },
    points: {
      ar: [
        "من «الإعدادات» أضف فرعاً جديداً، وانسخ إليه الخدمات وساعات العمل من الفرع الحالي إن أردت.",
        "انتقل بين الفروع من أعلى القائمة الجانبية، وقارن بينها في جدول «الفروع» في التقارير.",
      ],
      en: [
        "In Settings, add a branch and copy the current branch's services and hours to it if you like.",
        "Switch between branches at the top of the side menu, and compare them in the Branches table in Reports.",
      ],
    },
  },
  {
    id: "billing",
    href: "/billing",
    title: { ar: "الاشتراك", en: "Subscription" },
    points: {
      ar: [
        "تبدأ كل عيادة بفترة تجربة، ثم تختار خطتها وتجدّدها من صفحة «الاشتراك»، وتجد فيها فواتيرك.",
      ],
      en: ["Every clinic starts with a trial, then chooses and renews its plan on the Subscription page, where its invoices are."],
    },
  },
];

/** A WhatsApp chat with support, the clinic named in the message so the
 *  answer does not start with "which clinic?". null without a number. */
export function supportWhatsappUrl(number: string | null, message: string): string | null {
  const digits = (number ?? "").replace(/[^0-9]/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
