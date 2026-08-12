import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { SignupForm } from "./SignupForm";

export default async function SignupPage() {
  const lang = await getLang();

  return (
    <div className="center-shell">
      <div className="auth-card card">
        <h1>{t(lang, "signup_title")}</h1>
        <p className="sub">{t(lang, "brand")}</p>
        <SignupForm lang={lang} />
        <p className="hint" style={{ marginTop: 14 }}>
          {t(lang, "have_account")} <Link href="/login">{t(lang, "login_link")}</Link>
        </p>
      </div>
    </div>
  );
}
