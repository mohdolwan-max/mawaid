"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import type { OrgContext, BusinessHours } from "@/lib/types";
import { CATEGORIES, CITIES } from "@/lib/directory";
import { createClient } from "@/lib/supabase/client";
import { BusinessHoursGrid } from "@/components/BusinessHoursGrid";
import { saveOrgProfile, saveBookingRules, saveDirectoryProfile, saveMediaUrl } from "./actions";

export type DirectoryProfile = {
  isListed: boolean;
  category: string;
  city: string;
  district: string;
  description: string;
  priceTier: number | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
};

export function SettingsClient({
  ctx,
  canManage,
  directory,
  mapsUrl: initialMapsUrl,
}: {
  ctx: OrgContext;
  canManage: boolean;
  directory: DirectoryProfile;
  mapsUrl: string;
}) {
  const lang = ctx.lang;
  const [name, setName] = useState(ctx.name);
  const [address, setAddress] = useState(ctx.address ?? "");
  const [phone, setPhone] = useState(ctx.phone ?? "");
  const [mapsUrl, setMapsUrl] = useState(initialMapsUrl);
  const [savingProfile, setSavingProfile] = useState(false);

  const [hours, setHours] = useState<BusinessHours>(ctx.businessHours);
  const [slotInterval, setSlotInterval] = useState(ctx.slotIntervalMinutes);
  const [minNotice, setMinNotice] = useState(ctx.minNoticeMinutes);
  const [maxAdvance, setMaxAdvance] = useState(ctx.maxAdvanceDays);
  const [savingRules, setSavingRules] = useState(false);

  const [copied, setCopied] = useState(false);
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/${ctx.slug}` : `/${ctx.slug}`;

  // directory profile card state
  const [isListed, setIsListed] = useState(directory.isListed);
  const [category, setCategory] = useState(directory.category);
  const [city, setCity] = useState(directory.city);
  const [district, setDistrict] = useState(directory.district);
  const [description, setDescription] = useState(directory.description);
  const [priceTier, setPriceTier] = useState<number | null>(directory.priceTier);
  const [coverUrl, setCoverUrl] = useState(directory.coverImageUrl);
  const [logoUrl, setLogoUrl] = useState(directory.logoUrl);
  const [savingDir, setSavingDir] = useState(false);
  const [uploadingKind, setUploadingKind] = useState<"cover" | "logo" | null>(null);

  async function handleUpload(kind: "cover" | "logo", file: File) {
    setUploadingKind(kind);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${ctx.orgId}/${kind}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("org-media").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("org-media").getPublicUrl(path);
      await saveMediaUrl(kind, data.publicUrl);
      if (kind === "cover") setCoverUrl(data.publicUrl);
      else setLogoUrl(data.publicUrl);
    } finally {
      setUploadingKind(null);
    }
  }

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
          await saveOrgProfile({ name, address, phone, mapsUrl });
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
        <div className="field">
          <label htmlFor="s_maps_url">{t(lang, "org_maps_url")}</label>
          <input
            id="s_maps_url"
            dir="ltr"
            type="url"
            placeholder="https://maps.app.goo.gl/..."
            value={mapsUrl}
            disabled={!canManage}
            onChange={(e) => setMapsUrl(e.target.value)}
          />
          <p className="hint">{t(lang, "org_maps_url_hint")}</p>
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
          setSavingDir(true);
          await saveDirectoryProfile({ isListed, category, city, district, description, priceTier });
          setSavingDir(false);
        }}
      >
        <p style={{ fontWeight: 700 }}>{t(lang, "dir_profile_title")}</p>
        <p className="hint" style={{ marginBottom: 12 }}>{t(lang, "dir_profile_sub")}</p>

        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              disabled={!canManage}
              checked={isListed}
              onChange={(e) => setIsListed(e.target.checked)}
            />
            {t(lang, "dir_listed")}
          </label>
        </div>

        <div className="grid3">
          <div className="field">
            <label htmlFor="d_category">{t(lang, "dir_category")}</label>
            <select id="d_category" disabled={!canManage} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t(lang, "choose_option")}</option>
              {CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c[lang]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d_city">{t(lang, "dir_city")}</label>
            <select id="d_city" disabled={!canManage} value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">{t(lang, "choose_option")}</option>
              {CITIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c[lang]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="d_district">{t(lang, "dir_district")}</label>
            <input id="d_district" disabled={!canManage} value={district} onChange={(e) => setDistrict(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="d_desc">{t(lang, "dir_description")}</label>
          <textarea id="d_desc" rows={3} disabled={!canManage} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="d_tier">{t(lang, "dir_price_tier")}</label>
          <select
            id="d_tier"
            disabled={!canManage}
            value={priceTier ?? ""}
            onChange={(e) => setPriceTier(e.target.value === "" ? null : Number(e.target.value))}
            style={{ maxWidth: 200 }}
          >
            <option value="">{t(lang, "dir_price_none")}</option>
            <option value="1">$</option>
            <option value="2">$$</option>
            <option value="3">$$$</option>
          </select>
        </div>

        {canManage && (
          <div className="grid2">
            <div className="field">
              <label>{t(lang, "dir_cover")}</label>
              {coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
                <img src={coverUrl} alt="" style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, marginBottom: 6 }} />
              )}
              <input
                type="file"
                accept="image/*"
                disabled={uploadingKind !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload("cover", file);
                }}
              />
              {uploadingKind === "cover" && <p className="hint">{t(lang, "uploading")}</p>}
            </div>
            <div className="field">
              <label>{t(lang, "dir_logo")}</label>
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
                <img src={logoUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: "50%", marginBottom: 6 }} />
              )}
              <input
                type="file"
                accept="image/*"
                disabled={uploadingKind !== null}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload("logo", file);
                }}
              />
              {uploadingKind === "logo" && <p className="hint">{t(lang, "uploading")}</p>}
            </div>
          </div>
        )}

        {canManage && (
          <button type="submit" className="btn" disabled={savingDir}>
            {savingDir ? t(lang, "loading") : t(lang, "save")}
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
        <BusinessHoursGrid lang={lang} hours={hours} onChange={setHours} disabled={!canManage} />

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
