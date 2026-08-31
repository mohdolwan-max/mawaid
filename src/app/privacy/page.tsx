import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { BackBar } from "@/components/marketplace/BackBar";

export const metadata = { title: "سياسة الخصوصية | موعد" };

export default async function PrivacyPage() {
  const [lang, city] = await Promise.all([getLang(), getCity()]);

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />
      <BackBar href="/" title="" />
      <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
        {lang === "ar" ? <PrivacyAr /> : <PrivacyEn />}
      </div>
      <BottomNav lang={lang} />
    </div>
  );
}

function PrivacyAr() {
  return (
    <div style={{ lineHeight: 1.9, fontSize: 13.5 }}>
      <h1 style={{ color: "var(--brand)", fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        سياسة الخصوصية
      </h1>
      <p className="hint" style={{ marginBottom: 18 }}>آخر تحديث: أغسطس 2026</p>

      <p style={{ marginBottom: 14 }}>
        منصة &quot;موعد&quot; تربط بين العملاء والعيادات ومراكز التجميل لإتمام الحجوزات إلكترونياً.
        هذه السياسة توضح البيانات التي نجمعها وكيف نستخدمها ونحميها.
      </p>

      <h2 style={sectionStyle}>البيانات التي نجمعها</h2>
      <ul style={listStyle}>
        <li>بيانات الحجز: الاسم، رقم الجوال، والبريد الإلكتروني إن أدخلته.</li>
        <li>بيانات الحساب (للعملاء والمنشآت المسجَّلين): البريد الإلكتروني وكلمة مرور مشفّرة عبر مزوّد الخدمة.</li>
        <li>تفضيلات بسيطة نحفظها على جهازك (اللغة والمدينة المختارة).</li>
        <li>إذا فعّلت التذكيرات، نحفظ معرّف اشتراك الإشعارات الخاص بجهازك/متصفحك فقط.</li>
      </ul>

      <h2 style={sectionStyle}>كيف نستخدم بياناتك</h2>
      <ul style={listStyle}>
        <li>لإتمام حجزك وإرسال تأكيده وتذكيرك به إن وافقت على ذلك.</li>
        <li>لتمكين المنشأة التي حجزت لديها من إدارة موعدك.</li>
        <li>لتحسين المنصة وتشخيص الأعطال التقنية.</li>
      </ul>
      <p style={{ marginBottom: 14 }}>
        لا نستخدم بياناتك لأغراض تسويقية خارج المنصة، ولا نبيعها لأي طرف ثالث.
      </p>

      <h2 style={sectionStyle}>من يصل إلى بياناتك</h2>
      <ul style={listStyle}>
        <li>المنشأة التي قمت بالحجز لديها ترى بيانات حجزك فقط — ولا ترى بيانات أي منشأة أخرى.</li>
        <li>مزوّدو خدمات تقنية موثوقون نعتمد عليهم لتشغيل المنصة: استضافة قاعدة البيانات (Supabase)، استضافة الموقع (Vercel)، وإرسال رسائل تأكيد الحجز عبر البريد الإلكتروني.</li>
      </ul>
      <p style={{ marginBottom: 14 }}>
        بيانات كل منشأة معزولة تقنياً عن بيانات المنشآت الأخرى، بحيث لا يمكن لأي منشأة الوصول إلى حجوزات أو عملاء منشأة غيرها.
      </p>

      <h2 style={sectionStyle}>حقوقك وحذف الحساب</h2>
      <p style={{ marginBottom: 14 }}>
        يحق لك الاطلاع على بياناتك أو تعديلها، وتستطيع حذف حسابك نهائياً بنفسك من صفحة حسابك.
      </p>
      <ul style={listStyle}>
        <li>عند طلب الحذف تُلغى حجوزاتك القادمة فوراً ويصل إشعار بذلك للعيادات المعنية.</li>
        <li>يبقى الحساب قابلاً للاسترجاع لمدة 15 يوماً، تستطيع خلالها التراجع بتسجيل الدخول مرة أخرى.</li>
        <li>بعد انتهاء هذه المدة يُحذف حسابك وبياناتك الشخصية لدينا حذفاً نهائياً.</li>
        <li>
          استثناء مهم: تحتفظ كل عيادة حجزت لديها بسجلّها الخاص عن زياراتك السابقة (الاسم ورقم
          الجوال وتفاصيل الموعد)، باعتباره سجلاً تشغيلياً يخصّها. حذف حسابك لدينا لا يمحو سجلات
          العيادات، وللتواصل بشأنها يُرجى مراجعة العيادة مباشرة.
        </li>
      </ul>

      <h2 style={sectionStyle}>التواصل</h2>
      <p style={{ marginBottom: 6 }}>
        لأي استفسار بخصوص الخصوصية، راسلنا على{" "}
        <a href="mailto:privacy@mawaid.app">privacy@mawaid.app</a>.
      </p>

      <p className="hint" style={{ marginTop: 18 }}>
        هذه سياسة أولية عامة قد تُحدَّث دورياً؛ ننصح بمراجعتها بشكل دوري.
      </p>
    </div>
  );
}

function PrivacyEn() {
  return (
    <div style={{ lineHeight: 1.9, fontSize: 13.5 }}>
      <h1 style={{ color: "var(--brand)", fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        Privacy Policy
      </h1>
      <p className="hint" style={{ marginBottom: 18 }}>Last updated: August 2026</p>

      <p style={{ marginBottom: 14 }}>
        Maw3ed connects customers with clinics and beauty centers for online appointment booking.
        This policy explains what data we collect, how we use it, and how we protect it.
      </p>

      <h2 style={sectionStyle}>Data we collect</h2>
      <ul style={listStyle}>
        <li>Booking details: name, phone number, and email if you provide one.</li>
        <li>Account data (for registered customers and businesses): email and a password, encrypted by our service provider.</li>
        <li>Simple preferences stored on your device (chosen language and city).</li>
        <li>If you enable reminders, we store your device/browser&apos;s notification subscription identifier only.</li>
      </ul>

      <h2 style={sectionStyle}>How we use your data</h2>
      <ul style={listStyle}>
        <li>To complete your booking, confirm it, and remind you if you opted in.</li>
        <li>To let the business you booked with manage your appointment.</li>
        <li>To improve the platform and diagnose technical issues.</li>
      </ul>
      <p style={{ marginBottom: 14 }}>
        We do not use your data for marketing outside the platform, and we never sell it to third parties.
      </p>

      <h2 style={sectionStyle}>Who can access your data</h2>
      <ul style={listStyle}>
        <li>The business you booked with sees only your booking — never another business&apos;s data.</li>
        <li>Trusted technical service providers we rely on to run the platform: database hosting (Supabase), site hosting (Vercel), and booking-confirmation email delivery.</li>
      </ul>
      <p style={{ marginBottom: 14 }}>
        Each business&apos;s data is technically isolated from every other business — no business can access another&apos;s bookings or customers.
      </p>

      <h2 style={sectionStyle}>Your rights and account deletion</h2>
      <p style={{ marginBottom: 14 }}>
        You may access or correct your data, and you can permanently delete your account yourself from your account page.
      </p>
      <ul style={listStyle}>
        <li>On request, your upcoming bookings are cancelled immediately and the affected clinics are notified.</li>
        <li>The account stays recoverable for 15 days — sign back in during that window to undo.</li>
        <li>After that period your account and the personal data we hold are permanently deleted.</li>
        <li>
          One important exception: each clinic you booked with keeps its own record of your past
          visits (name, phone and appointment details) as its own business record. Deleting your
          account with us does not erase clinic records — contact the clinic directly about those.
        </li>
      </ul>

      <h2 style={sectionStyle}>Contact</h2>
      <p style={{ marginBottom: 6 }}>
        For privacy questions, email us at <a href="mailto:privacy@mawaid.app">privacy@mawaid.app</a>.
      </p>

      <p className="hint" style={{ marginTop: 18 }}>
        This is an initial general policy that may be updated periodically; please check back from time to time.
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
