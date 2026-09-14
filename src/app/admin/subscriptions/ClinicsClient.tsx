"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { daysLabel, daysLeft, isPlanId, monthsLabel, planName } from "@/lib/plan";
import { formatPrice } from "@/lib/billing";
import {
  ADMIN_TZ,
  clinicBucket,
  matchesClinic,
  reasonOk,
  type AdminClinic,
  type ClinicBucket,
} from "@/lib/admin";
import { adminExtendTrial, adminSetPlan, type AdminActionError } from "../actions";

const BUCKETS: ClinicBucket[] = ["paid", "trial", "grace", "lapsed", "closed"];

const BUCKET_KEY: Record<ClinicBucket, TKey> = {
  paid: "admin_bucket_paid",
  trial: "admin_bucket_trial",
  grace: "admin_bucket_grace",
  lapsed: "admin_bucket_lapsed",
  closed: "admin_bucket_closed",
};

const BUCKET_TONE: Record<ClinicBucket, string> = {
  paid: "good",
  trial: "neutral",
  grace: "warn",
  lapsed: "bad",
  closed: "neutral",
};

export function ClinicsClient({ lang, clinics, nowIso }: { lang: Lang; clinics: AdminClinic[]; nowIso: string }) {
  const [bucket, setBucket] = useState<ClinicBucket | "all">("all");
  const [query, setQuery] = useState("");
  const [showDemo, setShowDemo] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const pool = clinics.filter((c) => showDemo || !c.isDemo);
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, pool.filter((c) => clinicBucket(c) === b).length])) as Record<
    ClinicBucket,
    number
  >;
  const shown = pool.filter((c) => (bucket === "all" || clinicBucket(c) === bucket) && matchesClinic(c, query));

  return (
    <div className="admin-page">
      <div className="admin-filters">
        <div className="admin-chips" role="group">
          <button type="button" aria-pressed={bucket === "all"} onClick={() => setBucket("all")}>
            {t(lang, "admin_filter_all")} <span>{pool.length}</span>
          </button>
          {BUCKETS.map((b) => (
            <button key={b} type="button" aria-pressed={bucket === b} onClick={() => setBucket(b)}>
              {t(lang, BUCKET_KEY[b])} <span>{counts[b]}</span>
            </button>
          ))}
        </div>
        <input
          className="admin-search"
          type="search"
          value={query}
          placeholder={t(lang, "admin_search")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="admin-check">
          <input type="checkbox" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />
          {t(lang, "admin_show_demo")}
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="empty">{t(lang, "admin_no_results")}</div>
      ) : (
        <div className="admin-list">
          {shown.map((c) => (
            <ClinicRow
              key={c.id}
              lang={lang}
              clinic={c}
              nowIso={nowIso}
              open={openId === c.id}
              onToggle={() => setOpenId((id) => (id === c.id ? null : c.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ClinicRow({
  lang,
  clinic: c,
  nowIso,
  open,
  onToggle,
}: {
  lang: Lang;
  clinic: AdminClinic;
  nowIso: string;
  open: boolean;
  onToggle: () => void;
}) {
  const b = clinicBucket(c);
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), { timeZone: ADMIN_TZ, dateStyle: "medium" }).format(new Date(iso));
  const left = daysLeft(c.planExpiresAt, Date.parse(nowIso));
  const ended = c.planExpiresAt !== null && Date.parse(c.planExpiresAt) <= Date.parse(nowIso);

  const endLine =
    c.planExpiresAt === null
      ? t(lang, "admin_no_end")
      : ended
        ? t(lang, "admin_ended_on", { date: fmtDate(c.planExpiresAt) })
        : t(lang, "admin_ends_on", { date: fmtDate(c.planExpiresAt) }) +
          (left !== null ? ` · ${t(lang, "admin_days_left", { days: daysLabel(left, lang) })}` : "");

  return (
    <div className={`admin-row${open ? " open" : ""}`}>
      <button type="button" className="ar-head" aria-expanded={open} onClick={onToggle}>
        <span className="ar-title">
          <strong>{c.name}</strong>
          {c.isDemo && <span className="chip neutral">{t(lang, "admin_demo")}</span>}
        </span>
        <span className="ar-chips">
          <span className="chip neutral">
            {isPlanId(c.plan) ? planName(c.plan, lang) : c.plan}
          </span>
          <span className={`chip ${BUCKET_TONE[b]}`}>{t(lang, BUCKET_KEY[b])}</span>
        </span>
      </button>

      <div className="ar-meta">
        <span>{endLine}</span>
        <span>{t(lang, "admin_bookings_30d", { n: c.bookings30d })}</span>
        <span>{t(lang, "admin_services", { n: c.servicesCount })}</span>
        <span>
          {c.paidTotals.length === 0
            ? t(lang, "admin_never_paid")
            : t(lang, "admin_paid_total", {
                amount: c.paidTotals.map((m) => formatPrice(m.amount, m.currency, lang)).join("، "),
              })}
        </span>
        {c.autoRenew && <span>{t(lang, "admin_auto_renew_on", { card: c.cardLabel ?? "—" })}</span>}
      </div>

      {open && (
        <div className="ar-body">
          <p className="hint">
            {c.ownerEmail ? t(lang, "admin_owner", { email: c.ownerEmail }) : "—"} ·{" "}
            <a href={`/${c.slug}`} target="_blank" rel="noopener noreferrer" dir="ltr">
              /{c.slug}
            </a>
          </p>
          {c.phase !== "closed" && <PlanTool lang={lang} clinic={c} />}
          {c.phase !== "closed" && c.isTrial && <TrialTool lang={lang} clinic={c} />}
        </div>
      )}
    </div>
  );
}

const ERROR_KEY: Record<AdminActionError, TKey> = {
  admin_err_not_admin: "admin_err_not_admin",
  admin_err_reason: "admin_err_reason",
  admin_err_not_trial: "admin_err_not_trial",
  admin_err_org_closed: "admin_err_org_closed",
  admin_err_not_refundable: "admin_err_not_refundable",
  admin_err_offer_not_removable: "admin_err_offer_not_removable",
  error_generic: "error_generic",
};

// Propose, then apply (ENGINEERING-STANDARDS §2): the first press only
// shows what will change; nothing is written until "confirm".
function PlanTool({ lang, clinic }: { lang: Lang; clinic: AdminClinic }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [planId, setPlanId] = useState(isPlanId(clinic.plan) ? clinic.plan : "basic");
  const [months, setMonths] = useState("1");
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [done, setDone] = useState(false);

  const monthsValue = months === "none" ? null : Number(months);
  const duration =
    monthsValue === null
      ? t(lang, "admin_duration_forever")
      : t(lang, "admin_duration_months", { months: monthsLabel(monthsValue, lang) });

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await adminSetPlan({ orgId: clinic.id, planId, months: monthsValue, reason });
      if (res.error) {
        setError(ERROR_KEY[res.error]);
        return;
      }
      setReviewing(false);
      setReason("");
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="admin-tool">
      <p className="at-tool-title">{t(lang, "admin_set_plan")}</p>
      <div className="grid2">
        <div className="field">
          <label>{t(lang, "admin_plan")}</label>
          <select value={planId} onChange={(e) => { setPlanId(e.target.value as typeof planId); setReviewing(false); setDone(false); }}>
            <option value="basic">{planName("basic", lang)}</option>
            <option value="pro">{planName("pro", lang)}</option>
          </select>
        </div>
        <div className="field">
          <label>{t(lang, "admin_months")}</label>
          <select value={months} onChange={(e) => { setMonths(e.target.value); setReviewing(false); setDone(false); }}>
            {[1, 3, 6, 12].map((m) => (
              <option key={m} value={String(m)}>
                {monthsLabel(m, lang)}
              </option>
            ))}
            <option value="none">{t(lang, "admin_no_end_option")}</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>{t(lang, "admin_reason")}</label>
        <input value={reason} placeholder={t(lang, "admin_reason_ph")} onChange={(e) => { setReason(e.target.value); setDone(false); }} />
      </div>
      {reviewing && (
        <p className="admin-confirm">
          {t(lang, "admin_confirm_plan", { clinic: clinic.name, plan: planName(planId, lang), duration })}
        </p>
      )}
      {error && <p className="error-text">{t(lang, error)}</p>}
      {done && <p className="hint">{t(lang, "admin_done")}</p>}
      <div className="toolbar">
        {!reviewing ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setDone(false);
              if (!reasonOk(reason)) {
                setError("admin_err_reason");
                return;
              }
              setError(null);
              setReviewing(true);
            }}
          >
            {t(lang, "admin_review")}
          </button>
        ) : (
          <>
            <button type="button" className="btn sm" disabled={pending} onClick={apply}>
              {t(lang, "admin_confirm")}
            </button>
            <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setReviewing(false)}>
              {t(lang, "admin_back")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TrialTool({ lang, clinic }: { lang: Lang; clinic: AdminClinic }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [done, setDone] = useState(false);

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await adminExtendTrial({ orgId: clinic.id, days: Number(days), reason });
      if (res.error) {
        setError(ERROR_KEY[res.error]);
        return;
      }
      setReviewing(false);
      setReason("");
      setDone(true);
      router.refresh();
    });
  }

  return (
    <div className="admin-tool">
      <p className="at-tool-title">{t(lang, "admin_extend_trial")}</p>
      <div className="grid2">
        <div className="field">
          <label>{t(lang, "admin_days")}</label>
          <select value={days} onChange={(e) => { setDays(e.target.value); setReviewing(false); setDone(false); }}>
            {[7, 14, 30].map((d) => (
              <option key={d} value={String(d)}>
                {daysLabel(d, lang)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t(lang, "admin_reason")}</label>
          <input value={reason} placeholder={t(lang, "admin_reason_ph")} onChange={(e) => { setReason(e.target.value); setDone(false); }} />
        </div>
      </div>
      {reviewing && (
        <p className="admin-confirm">
          {t(lang, "admin_confirm_trial", { clinic: clinic.name, days: daysLabel(Number(days), lang) })}
        </p>
      )}
      {error && <p className="error-text">{t(lang, error)}</p>}
      {done && <p className="hint">{t(lang, "admin_done")}</p>}
      <div className="toolbar">
        {!reviewing ? (
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              setDone(false);
              if (!reasonOk(reason)) {
                setError("admin_err_reason");
                return;
              }
              setError(null);
              setReviewing(true);
            }}
          >
            {t(lang, "admin_review")}
          </button>
        ) : (
          <>
            <button type="button" className="btn sm" disabled={pending} onClick={apply}>
              {t(lang, "admin_confirm")}
            </button>
            <button type="button" className="btn ghost sm" disabled={pending} onClick={() => setReviewing(false)}>
              {t(lang, "admin_back")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
