"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { OrgContext, BusinessHours } from "@/lib/types";
import { saveOrgProfile, saveBookingRules } from "./actions";

const DAY_KEYS = ["day_sun", "day_mon", "day_tue", "day_wed", "day_thu", "day_fri", "day_sat"] as const;

export function SettingsClient({ ctx, canManage }: { ctx: OrgContext; canManage: boolean }) {
  const lang = ctx.lang;
  const [name, setName] = useState(ctx.name);
  const [address, setAddress] = useState(ctx.address ?? "");
  const [phone, setPhone] = useState(ctx.phone ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [hours, setHours] = useState<BusinessHours>(ctx.businessHours);
  const [slotInterval, setSlotInterval] = useState(ctx.slotIntervalMinutes);
  const [minNotice, setMinNotice] = useState(ctx.minNoticeMinutes);
  const [maxAdvance, setMaxAdvance] = useState(ctx.maxAdvanceDays);
  const [savingRules, setSavingRules] = useState(false);

  const [copied, setCopied] = useState(false);
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/${ctx.slug}` : `/${ctx.slug}`;

  return (
    <div>
      <div className="card">
        <label>{t(lang, "public_link_label")}</label>
        <div className="toolbar">
          <input readOnly dir="ltr" value={publicUrl} style={{ flex: 1 }} />
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              navigator.clipboard.writeText(publicUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? t(lang, "confirm") : t(lang, "copy_link")}
          </button>
        </div>
      </div>

      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setSavingProfile(true);
          await saveOrgProfile({ name, address, phone });
          setSavingProfile(false);
        }}
      >
        <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "settings_org")}</p>
        <div className="field">
          <label htmlFor="s_name">{t(lang, "org_name")}</label>
          <input id="s_name" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="s_address">{t(lang, "org_address")}</label>
            <input id="s_address" value={address} disabled={!canManage} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s_phone">{t(lang, "org_phone")}</label>
            <input id="s_phone" dir="ltr" value={phone} disabled={!canManage} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        {canManage && (
          <button type="submit" className="btn" disabled={savingProfile}>
            {savingProfile ? t(lang, "loading") : t(lang, "save")}
          </button>
        )}
      </form>

      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setSavingRules(true);
          await saveBookingRules({
            businessHours: hours,
            slotIntervalMinutes: slotInterval,
            minNoticeMinutes: minNotice,
            maxAdvanceDays: maxAdvance,
          });
          setSavingRules(false);
        }}
      >
        <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "settings_hours")}</p>
        {DAY_KEYS.map((dayKey, idx) => {
          const key = String(idx);
          const day = hours[key];
          return (
            <div key={key} className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 90, fontSize: 12.5, fontWeight: 600 }}>{t(lang, dayKey)}</span>
              <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 0 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  disabled={!canManage}
                  checked={!day.closed}
                  onChange={(e) => setHours({ ...hours, [key]: { ...day, closed: !e.target.checked } })}
                />
                {t(lang, "open")}
              </label>
              {!day.closed && (
                <>
                  <input
                    type="time"
                    dir="ltr"
                    disabled={!canManage}
                    value={day.open}
                    onChange={(e) => setHours({ ...hours, [key]: { ...day, open: e.target.value } })}
                  />
                  <input
                    type="time"
                    dir="ltr"
                    disabled={!canManage}
                    value={day.close}
                    onChange={(e) => setHours({ ...hours, [key]: { ...day, close: e.target.value } })}
                  />
                </>
              )}
            </div>
          );
        })}

        <p style={{ fontWeight: 700, margin: "16px 0 10px" }}>{t(lang, "settings_booking_rules")}</p>
        <div className="grid3">
          <div className="field">
            <label htmlFor="s_slot">{t(lang, "slot_interval")}</label>
            <input
              id="s_slot"
              type="number"
              min={5}
              step={5}
              disabled={!canManage}
              value={slotInterval}
              onChange={(e) => setSlotInterval(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="s_notice">{t(lang, "min_notice")}</label>
            <input
              id="s_notice"
              type="number"
              min={0}
              step={15}
              disabled={!canManage}
              value={minNotice}
              onChange={(e) => setMinNotice(Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="s_advance">{t(lang, "max_advance")}</label>
            <input
              id="s_advance"
              type="number"
              min={1}
              disabled={!canManage}
              value={maxAdvance}
              onChange={(e) => setMaxAdvance(Number(e.target.value))}
            />
          </div>
        </div>

        {canManage && (
          <button type="submit" className="btn" disabled={savingRules}>
            {savingRules ? t(lang, "loading") : t(lang, "save")}
          </button>
        )}
      </form>
    </div>
  );
}
