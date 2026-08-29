import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [lang, { next }] = await Promise.all([getLang(), searchParams]);
  // Same-site-only guard, same reasoning as /auth/callback.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/login";

  return (
    <div className="center-shell">
      <div className="auth-card card">
        <h1>{t(lang, "forgot_password_title")}</h1>
        <p className="sub">{t(lang, "forgot_password_sub")}</p>
        <ForgotPasswordForm lang={lang} next={safeNext} />
        <p className="hint" style={{ marginTop: 14 }}>
          <Link href={safeNext}>{t(lang, "back_to_login")}</Link>
        </p>
      </div>
    </div>
  );
}
