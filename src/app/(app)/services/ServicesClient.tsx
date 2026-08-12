"use client";

import { useRef } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { Service } from "@/lib/types";
import { addService, toggleServiceActive, deleteService } from "./actions";

export function ServicesClient({
  lang,
  services,
  canManage,
}: {
  lang: Lang;
  services: Service[];
  canManage: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div>
      {canManage && (
        <div className="card">
          <form
            ref={formRef}
            action={async (formData) => {
              await addService(formData);
              formRef.current?.reset();
            }}
          >
            <div className="grid3">
              <div className="field">
                <label htmlFor="name">{t(lang, "service_name")}</label>
                <input id="name" name="name" required />
              </div>
              <div className="field">
                <label htmlFor="duration">{t(lang, "service_duration")}</label>
                <input id="duration" name="duration" type="number" min={5} step={5} defaultValue={30} required />
              </div>
              <div className="field">
                <label htmlFor="price">{t(lang, "service_price")}</label>
                <input id="price" name="price" type="number" min={0} step={0.01} />
              </div>
            </div>
            <button type="submit" className="btn">
              {t(lang, "service_add")}
            </button>
          </form>
        </div>
      )}

      {services.length === 0 ? (
        <div className="empty">{t(lang, "service_empty")}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(lang, "service_name")}</th>
                <th className="num">{t(lang, "service_duration")}</th>
                <th className="num">{t(lang, "service_price")}</th>
                <th></th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="num">{s.duration_minutes}</td>
                  <td className="num">{s.price != null ? s.price : "—"}</td>
                  <td>
                    <span className={`chip ${s.active ? "good" : "neutral"}`}>
                      {t(lang, s.active ? "active" : "inactive")}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <div className="toolbar">
                        <button className="btn ghost sm" onClick={() => toggleServiceActive(s.id, !s.active)}>
                          {t(lang, s.active ? "inactive" : "active")}
                        </button>
                        <button className="btn danger sm" onClick={() => deleteService(s.id)}>
                          {t(lang, "delete")}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
