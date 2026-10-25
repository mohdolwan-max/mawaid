"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import type { MyOrg } from "@/lib/branches";
import { createBranchAction, switchOrgAction } from "../actions";

// The owner's clinics and opening another (0071). Every branch is a whole
// clinic: its own page, specialists, services, hours and subscription.
export function BranchesCard({ lang, orgs, activeOrgId }: { lang: Lang; orgs: MyOrg[]; activeOrgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const owned = orgs.filter((o) => o.role === "owner");

  async function create() {
    setBusy(true);
    setError(null);
    const r = await createBranchAction({ name, slug, fromOrgId: activeOrgId, copyServices: copy });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function go(id: string) {
    const r = await switchOrgAction(id);
    if (r.ok) router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="pkg-head">
        <div>
          <p style={{ fontWeight: 700 }}>{t(lang, "branch_title")}</p>
          <p className="hint">{t(lang, "branch_sub")}</p>
        </div>
        {!open && (
          <button type="button" className="btn sm" onClick={() => setOpen(true)}>
            {t(lang, "branch_add")}
          </button>
        )}
      </div>

      {open && (
        <div className="pkg-sell">
          <div className="grid2">
            <div className="field">
              <label htmlFor="br-name">{t(lang, "branch_name")}</label>
              <input id="br-name" value={name} maxLength={120} placeholder={t(lang, "branch_name_ph")} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="br-slug">{t(lang, "branch_slug")}</label>
              <input
                id="br-slug"
                dir="ltr"
                value={slug}
                maxLength={63}
                placeholder="clinic-abdoun"
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              />
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            {t(lang, "branch_copy_services")}
          </label>
          <p className="hint" style={{ marginTop: 6 }}>{t(lang, "branch_hint")}</p>
          {error && <p className="error-text">{t(lang, error)}</p>}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" disabled={busy || !name.trim() || !slug} onClick={() => void create()}>
              {busy ? t(lang, "loading") : t(lang, "branch_create")}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      )}

      <ul className="pkg-list">
        {owned.map((o) => (
          <li key={o.orgId}>
            <div className="cv-top">
              <strong>{o.name}</strong>
              {o.orgId === activeOrgId ? (
                <span className="chip good">{t(lang, "branch_current")}</span>
              ) : (
                <button type="button" className="btn ghost sm" onClick={() => void go(o.orgId)}>
                  {t(lang, "branch_open")}
                </button>
              )}
            </div>
            <p className="hint" dir="ltr" style={{ textAlign: "start" }}>
              /{o.slug}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
