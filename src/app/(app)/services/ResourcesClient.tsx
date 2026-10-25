"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import type { Service } from "@/lib/types";
import { RESOURCE_CAPACITY_MAX, RESOURCE_NAME_MAX, type Resource, type ResourceKind } from "@/lib/resources";
import { deleteResourceAction, saveResourceAction } from "./actions";

type Draft = { name: string; kind: ResourceKind; capacity: string; serviceIds: string[] };

// Rooms and devices (0068): what a service needs besides a specialist.
// A service is offered at a time only when everything it needs has room.
export function ResourcesClient({
  lang,
  resources,
  services,
  canManage,
}: {
  lang: Lang;
  /** null = could not be read; said as such, never "none". */
  resources: Resource[] | null;
  services: Service[];
  canManage: boolean;
}) {
  const router = useRouter();
  const count = (n: number) => n.toLocaleString(intlLocale(lang));
  const blank: Draft = { name: "", kind: "device", capacity: "1", serviceIds: [] };
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  function open(r: Resource | null) {
    setDraft(r ? { name: r.name, kind: r.kind, capacity: String(r.capacity), serviceIds: [...r.serviceIds] } : blank);
    setEditing(r ? r.id : "new");
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await saveResourceAction(editing === "new" ? null : editing, draft, draft.serviceIds);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function remove(r: Resource) {
    if (!window.confirm(t(lang, "res_confirm_delete", { name: r.name }))) return;
    const res = await deleteResourceAction(r.id);
    if (!res.ok) setError("error_generic");
    router.refresh();
  }

  const toggleService = (id: string, on: boolean) =>
    setDraft((d) => ({ ...d, serviceIds: on ? [...d.serviceIds, id] : d.serviceIds.filter((x) => x !== id) }));

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="pkg-head">
        <div>
          <p style={{ fontWeight: 700 }}>{t(lang, "res_title")}</p>
          <p className="hint">{t(lang, "res_sub")}</p>
        </div>
        {canManage && resources !== null && editing === null && (
          <button type="button" className="btn sm" onClick={() => open(null)}>
            {t(lang, "res_add")}
          </button>
        )}
      </div>

      {editing !== null && (
        <div className="pkg-sell">
          <div className="grid3">
            <div className="field">
              <label htmlFor="res-name">{t(lang, "res_name")}</label>
              <input
                id="res-name"
                value={draft.name}
                maxLength={RESOURCE_NAME_MAX}
                placeholder={t(lang, "res_name_ph")}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="res-kind">{t(lang, "res_kind")}</label>
              <select id="res-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ResourceKind })}>
                <option value="device">{t(lang, "res_kind_device")}</option>
                <option value="room">{t(lang, "res_kind_room")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="res-cap">{t(lang, "res_capacity")}</label>
              <input
                id="res-cap"
                type="number"
                inputMode="numeric"
                min={1}
                max={RESOURCE_CAPACITY_MAX}
                step={1}
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
              />
            </div>
          </div>
          <p className="hint">{t(lang, "res_capacity_hint")}</p>
          <p style={{ fontWeight: 700, margin: "10px 0 4px" }}>{t(lang, "res_services")}</p>
          {services.length === 0 ? (
            <p className="hint">{t(lang, "pkgcat_need_service")}</p>
          ) : (
            <div className="res-services">
              {services.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={draft.serviceIds.includes(s.id)}
                    onChange={(e) => toggleService(s.id, e.target.checked)}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          )}
          {error && <p className="error-text">{t(lang, error)}</p>}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
              {busy ? t(lang, "loading") : t(lang, "save")}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(null)}>
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      )}

      {editing === null && error && <p className="error-text">{t(lang, error)}</p>}

      {resources === null ? (
        <p className="error-text">{t(lang, "error_generic")}</p>
      ) : resources.length === 0 ? (
        <p className="hint" style={{ marginTop: 8 }}>{t(lang, "res_empty")}</p>
      ) : (
        <ul className="pkg-list">
          {resources.map((r) => (
            <li key={r.id}>
              <div className="cv-top">
                <strong>{r.name}</strong>
                <span className="chip neutral">
                  {t(lang, r.kind === "room" ? "res_kind_room" : "res_kind_device")} ·{" "}
                  {t(lang, "res_capacity_n", { n: count(r.capacity) })}
                </span>
              </div>
              <p className="cv-what">
                {r.serviceIds.length === 0
                  ? t(lang, "res_no_services")
                  : r.serviceIds.map((id) => serviceName.get(id) ?? "—").join("، ")}
              </p>
              {canManage && (
                <div className="toolbar" style={{ marginTop: 6 }}>
                  <button type="button" className="btn ghost sm" onClick={() => open(r)}>
                    {t(lang, "edit")}
                  </button>
                  <button type="button" className="btn danger sm" onClick={() => void remove(r)}>
                    {t(lang, "delete")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
