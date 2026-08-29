import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { BackBar } from "@/components/marketplace/BackBar";

export const metadata = { title: "شروط الاستخدام | مواعيد" };

export default async function TermsPage() {
  const [lang, city] = await Promise.all([getLang(), getCity()]);

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />
      <BackBar href="/" title="" />
      <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
        {lang === "ar" ? <TermsAr /> : <TermsEn />}
      </div>
      <BottomNav lang={lang} />
    </div>
  );
}

function TermsAr() {
  return (
    <div style={{ lineHeight: 1.9, fontSize: 13.5 }}>
      <h1 style={{ color: "var(--brand)", fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        شروط الاستخدام
      </h1>
      <p className="hint" style={{ marginBottom: 18 }}>آخر تحديث: أغسطس 2026</p>

      <p style={{ marginBottom: 14 }}>
        باستخدامك منصة &quot;مواعيد&quot; فإنك توافق على الشروط التالية. إذا كنت لا توافق عليها، يرجى عدم استخدام المنصة.
      </p>

      <h2 style={sectionStyle}>طبيعة الخدمة</h2>
      <p style={{ marginBottom: 14 }}>
        &quot;مواعيد&quot; منصة تقنية تتيح للعملاء اكتشاف العيادات ومراكز التجميل وحجز موعد لديها إلكترونياً.
        المنصة وسيط تقني بين العميل والمنشأة، والمنشأة هي المسؤولة عن الخدمة الطبية أو التجميلية المقدَّمة فعلياً وجودتها والالتزام بمواعيدها.
      </p>

      <h2 style={sectionStyle}>الحجز والإلغاء</h2>
      <ul style={listStyle}>
        <li>يجب تقديم بيانات تواصل صحيحة عند الحجز.</li>
        <li>يمكنك إلغاء حجزك في أي وقت عبر رابط إدارة الحجز المُرسَل إليك.</li>
        <li>الحجوزات المتكررة الوهمية أو التي تهدف لإرباك جدول المنشأة غير مسموحة، وقد تُلغى دون إشعار مسبق.</li>
      </ul>

      <h2 style={sectionStyle}>مسؤوليات المنشآت المسجَّلة</h2>
      <ul style={listStyle}>
        <li>تقديم بيانات دقيقة عن الخدمات وساعات العمل والأسعار.</li>
        <li>الالتزام بالمواعيد المحجوزة عبر المنصة أو التواصل مع العميل في حال أي تعديل.</li>
      </ul>

      <h2 style={sectionStyle}>حدود المسؤولية</h2>
      <p style={{ marginBottom: 14 }}>
        المنصة لا تتحمل مسؤولية جودة الخدمة الطبية أو التجميلية المقدَّمة من أي منشأة، ولا أي نزاع مباشر بين
        العميل والمنشأة بخصوص تلك الخدمة. نسعى لتوفير بيئة موثوقة، لكن التعامل الفعلي يبقى بين العميل والمنشأة.
      </p>

      <h2 style={sectionStyle}>التعديلات</h2>
      <p style={{ marginBottom: 14 }}>
        قد تُحدَّث هذه الشروط من وقت لآخر، واستمرارك في استخدام المنصة بعد التحديث يُعد قبولاً بها.
      </p>

      <h2 style={sectionStyle}>القانون الحاكم</h2>
      <p style={{ marginBottom: 14 }}>تخضع هذه الشروط لأنظمة المملكة الأردنية الهاشمية.</p>

      <h2 style={sectionStyle}>التواصل</h2>
      <p style={{ marginBottom: 6 }}>
        لأي استفسار، راسلنا على <a href="mailto:info@mawaid.app">info@mawaid.app</a>.
      </p>

      <p className="hint" style={{ marginTop: 18 }}>
        هذه شروط أولية عامة، ونوصي بمراجعة قانونية متخصصة قبل الإطلاق الرسمي الكامل.
      </p>
    </div>
  );
}

function TermsEn() {
  return (
    <div style={{ lineHeight: 1.9, fontSize: 13.5 }}>
      <h1 style={{ color: "var(--brand)", fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        Terms of Use
      </h1>
      <p className="hint" style={{ marginBottom: 18 }}>Last updated: August 2026</p>

      <p style={{ marginBottom: 14 }}>
        By using Mawaid, you agree to the following terms. If you do not agree, please do not use the platform.
      </p>

      <h2 style={sectionStyle}>Nature of the service</h2>
      <p style={{ marginBottom: 14 }}>
        Mawaid is a technical platform that lets customers discover clinics and beauty centers and book
        appointments online. The platform is a technical intermediary between the customer and the
        business; the business is responsible for the actual medical/aesthetic service, its quality, and
        keeping its scheduled appointments.
      </p>

      <h2 style={sectionStyle}>Booking and cancellation</h2>
      <ul style={listStyle}>
        <li>You must provide accurate contact details when booking.</li>
        <li>You may cancel your booking at any time via the manage-booking link sent to you.</li>
        <li>Repeated fake bookings, or bookings intended to disrupt a business&apos;s schedule, are not allowed and may be removed without prior notice.</li>
      </ul>

      <h2 style={sectionStyle}>Registered businesses&apos; responsibilities</h2>
      <ul style={listStyle}>
        <li>Provide accurate information about services, business hours, and pricing.</li>
        <li>Honor bookings made through the platform, or contact the customer for any change.</li>
      </ul>

      <h2 style={sectionStyle}>Limitation of liability</h2>
      <p style={{ marginBottom: 14 }}>
        The platform is not responsible for the quality of medical/aesthetic services provided by any
        business, nor for direct disputes between a customer and a business regarding that service. We aim
        to provide a trustworthy environment, but the actual engagement remains between customer and business.
      </p>

      <h2 style={sectionStyle}>Changes</h2>
      <p style={{ marginBottom: 14 }}>
        These terms may be updated from time to time; continued use of the platform after an update
        constitutes acceptance.
      </p>

      <h2 style={sectionStyle}>Governing law</h2>
      <p style={{ marginBottom: 14 }}>These terms are governed by the laws of the Hashemite Kingdom of Jordan.</p>

      <h2 style={sectionStyle}>Contact</h2>
      <p style={{ marginBottom: 6 }}>
        For any questions, email us at <a href="mailto:info@mawaid.app">info@mawaid.app</a>.
      </p>

      <p className="hint" style={{ marginTop: 18 }}>
        This is an initial general set of terms; we recommend specialized legal review before a full official launch.
      </p>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  color: "var(--brand)",
  fontSize: 14.5,
  fontWeight: 800,
  marginTop: 18,
  marginBottom: 8,
};

const listStyle: React.CSSProperties = {
  marginBottom: 14,
  paddingInlineStart: 20,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};
