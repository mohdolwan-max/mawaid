import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const lang = await getLang();

  return (
    <div className="center-shell">
      <div className="auth-card card">
        <h1>{t(lang, "login_title")}</h1>
        <p className="sub">{t(lang, "brand")}</p>
        <LoginForm lang={lang} />
        <p className="hint" style={{ marginTop: 14 }}>
          {t(lang, "no_account")} <Link href="/signup">{t(lang, "signup_link")}</Link>
        </p>
        <p className="hint">
          <Link href="/account">{t(lang, "are_you_customer")}</Link>
        </p>
      </div>
    </div>
  );
}
