import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const [lang, { link }] = await Promise.all([getLang(), searchParams]);

  return (
    <div className="center-shell">
      <div className="auth-card card">
        <h1>{t(lang, "login_title")}</h1>
        <p className="sub">{t(lang, "brand")}</p>
        {/* /auth/confirm sends a used, expired or broken email link here.
            Without this line the person just saw the login form and
            could not tell why the email button had not worked. */}
        {link === "expired" && <p className="offer-notice">{t(lang, "auth_link_expired")}</p>}
        <LoginForm lang={lang} />
        <p className="hint" style={{ marginTop: 14 }}>
          <Link href="/forgot-password">{t(lang, "forgot_password_link")}</Link>
        </p>
        <p className="hint">
          {t(lang, "no_account")} <Link href="/signup">{t(lang, "signup_link")}</Link>
        </p>
        <p className="hint">
          <Link href="/account">{t(lang, "are_you_customer")}</Link>
        </p>
      </div>
    </div>
  );
}
