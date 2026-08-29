import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [lang, { next }, supabase] = await Promise.all([getLang(), searchParams, createClient()]);
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/login";

  // /auth/callback already exchanged the recovery link's code for a
  // session before landing here — if there's no user, the link was
  // reused, expired, or this page was opened directly.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="center-shell">
      <div className="auth-card card">
        <h1>{t(lang, "reset_password_title")}</h1>
        <p className="sub">{t(lang, "brand")}</p>
        {user ? (
          <ResetPasswordForm lang={lang} next={safeNext} />
        ) : (
          <>
            <p className="error-text">{t(lang, "reset_password_error")}</p>
            <p className="hint" style={{ marginTop: 14 }}>
              <Link href="/forgot-password">{t(lang, "forgot_password_link")}</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
