"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { OrgContext, BusinessHours } from "@/lib/types";
import { CATEGORIES, CITIES, PRICE_TIERS, parseMapsLink } from "@/lib/directory";
import { createClient } from "@/lib/supabase/client";
import { validateImageFile, downscaleImage, MAX_DIM } from "@/lib/imageUpload";
import { BusinessHoursGrid } from "@/components/BusinessHoursGrid";
import { saveOrgProfile, saveBookingRules, saveDirectoryProfile, saveMediaUrl, closeOrganization } from "./actions";

// An Arabic-locale mobile keyboard on inputMode="decimal" produces
// Arabic-Indic digits (٣١٫٩) — and Number("٣١٫٩") is NaN, which used to
// surface as a WRONG-CAUSE error about pairing while the owner stared at
// two perfectly filled fields. Normalised at submit time, not on every
// keystroke, so the owner sees what they typed.
function normalizeDecimal(raw: string): string {
  return raw
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .replace(/٬/g, "");
}

export type DirectoryProfile = {
  isListed: boolean;
  category: string;
  city: string;
  district: string;
  description: string;
  priceTier: number | null;
  coverImageUrl: string | null;
  logoUrl: string | null;
  lat: number | null;
  lng: number | null;
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
  const [profileSaved, setProfileSaved] = useState<"" | "ok" | "failed">("");

  const [hours, setHours] = useState<BusinessHours>(ctx.businessHours);
  const [slotInterval, setSlotInterval] = useState(ctx.slotIntervalMinutes);
  const [minNotice, setMinNotice] = useState(ctx.minNoticeMinutes);
  const [maxAdvance, setMaxAdvance] = useState(ctx.maxAdvanceDays);
  const [savingRules, setSavingRules] = useState(false);
  const [rulesSaved, setRulesSaved] = useState<"" | "ok" | "failed">("");

  const [copied, setCopied] = useState(false);
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/${ctx.slug}` : `/${ctx.slug}`;

  // directory profile card state
  const [isListed, setIsListed] = useState(directory.isListed);
  const [category, setCategory] = useState(directory.category);
  const [city, setCity] = useState(directory.city);
  const [district, setDistrict] = useState(directory.district);
  const [description, setDescription] = useState(directory.description);
  const [priceTier, setPriceTier] = useState<number | null>(directory.priceTier);
  // Kept as strings: a number input state would turn "" into 0 the first
  // time it round-trips, and 0,0 is a real place in the Atlantic.
  const [latStr, setLatStr] = useState(directory.lat === null ? "" : String(directory.lat));
  const [lngStr, setLngStr] = useState(directory.lng === null ? "" : String(directory.lng));
  const [locMsg, setLocMsg] = useState<"" | "loc_parsed" | "loc_parse_failed" | "loc_pair_error" | "loc_format_error" | "loc_geo_failed">("");
  const [locating, setLocating] = useState(false);
  const [coverUrl, setCoverUrl] = useState(directory.coverImageUrl);
  const [logoUrl, setLogoUrl] = useState(directory.logoUrl);
  const [savingDir, setSavingDir] = useState(false);
  const [dirSaved, setDirSaved] = useState<"" | "ok" | "failed">("");
  const [uploadingKind, setUploadingKind] = useState<"cover" | "logo" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleUpload(kind: "cover" | "logo", file: File) {
    setUploadError(null);
    const validationError = validateImageFile(file, lang);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setUploadingKind(kind);
    try {
      // Shrink before upload: a cover renders ~170px tall and a logo
      // 56px, so a full-size phone photo is bytes nobody ever sees.
      const upload = await downscaleImage(file, kind === "cover" ? MAX_DIM.cover : MAX_DIM.logo);
      const supabase = createClient();
      const ext = (upload.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${ctx.orgId}/${kind}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("org-media").upload(path, upload, { upsert: true });
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
          const r = await saveOrgProfile({ name, address, phone, mapsUrl });
          setProfileSaved(r.ok ? "ok" : "failed");
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
        {profileSaved === "ok" && <p className="hint" style={{ color: "var(--good-ink)", marginTop: 6 }}>{t(lang, "save_ok")}</p>}
        {profileSaved === "failed" && <p className="error-text" style={{ marginTop: 6 }}>{t(lang, "save_failed")}</p>}
      </form>

      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setSavingDir(true);
          const latTrim = normalizeDecimal(latStr);
          const lngTrim = normalizeDecimal(lngStr);
          const lat = latTrim === "" ? null : Number(latTrim);
          const lng = lngTrim === "" ? null : Number(lngTrim);
          const bothFilled = lat !== null && lng !== null;
          const validPair =
            bothFilled &&
            Number.isFinite(lat) && Number.isFinite(lng) &&
            Math.abs(lat!) <= 90 && Math.abs(lng!) <= 180;
          const clearedPair = lat === null && lng === null;
          if (!validPair && !clearedPair) {
            // Two different failures get two different messages: half a
            // pair is a pairing problem; two filled fields that do not
            // parse (or sit out of range) are a format problem, and
            // telling the owner "pair them" while both are filled sends
            // them hunting the wrong bug.
            setLocMsg(bothFilled ? "loc_format_error" : "loc_pair_error");
            setSavingDir(false);
            return;
          }
          setLocMsg("");
          const dirResult = await saveDirectoryProfile({ isListed, category, city, district, description, priceTier, lat, lng });
          setDirSaved(dirResult.ok ? "ok" : "failed");
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
            {/* The same words the public cards show — the owner picks what
                the customer will actually read, not a currency glyph. */}
            <option value="1">{PRICE_TIERS[1][lang]}</option>
            <option value="2">{PRICE_TIERS[2][lang]}</option>
            <option value="3">{PRICE_TIERS[3][lang]}</option>
          </select>
        </div>

        <div className="field" style={{ marginTop: 4 }}>
          <label>{t(lang, "loc_title")}</label>
          <p className="hint" style={{ marginBottom: 8 }}>{t(lang, "loc_sub")}</p>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <button
              type="button"
              className="btn ghost sm"
              disabled={!canManage || locating}
              onClick={() => {
                // The owner is usually standing IN the clinic, which makes
                // this the most accurate way to set the pin. Fills the
                // fields only — nothing is saved until the save button,
                // so a bad fix can simply be edited or cleared.
                if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
                  setLocMsg("loc_geo_failed");
                  return;
                }
                setLocating(true);
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setLatStr(pos.coords.latitude.toFixed(5));
                    setLngStr(pos.coords.longitude.toFixed(5));
                    setLocMsg("");
                    setLocating(false);
                  },
                  () => {
                    setLocMsg("loc_geo_failed");
                    setLocating(false);
                  },
                  { enableHighAccuracy: true, timeout: 10000 }
                );
              }}
            >
              {locating ? t(lang, "loading") : t(lang, "loc_use_current")}
            </button>
            <button
              type="button"
              className="btn ghost sm"
              disabled={!canManage || !mapsUrl.trim()}
              onClick={() => {
                const parsed = parseMapsLink(mapsUrl);
                if (!parsed) {
                  setLocMsg("loc_parse_failed");
                  return;
                }
                setLatStr(parsed.lat.toFixed(5));
                setLngStr(parsed.lng.toFixed(5));
                setLocMsg("loc_parsed");
              }}
            >
              {t(lang, "loc_from_link")}
            </button>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="d_lat">{t(lang, "loc_lat")}</label>
              <input
                id="d_lat"
                dir="ltr"
                inputMode="decimal"
                disabled={!canManage}
                value={latStr}
                onChange={(e) => setLatStr(e.target.value)}
                placeholder="31.94350"
              />
            </div>
            <div className="field">
              <label htmlFor="d_lng">{t(lang, "loc_lng")}</label>
              <input
                id="d_lng"
                dir="ltr"
                inputMode="decimal"
                disabled={!canManage}
                value={lngStr}
                onChange={(e) => setLngStr(e.target.value)}
                placeholder="35.88150"
              />
            </div>
          </div>
          {locMsg === "loc_parsed" && <p className="hint" style={{ color: "var(--good-ink)" }}>{t(lang, "loc_parsed")}</p>}
          {locMsg === "loc_parse_failed" && <p className="error-text">{t(lang, "loc_parse_failed")}</p>}
          {locMsg === "loc_geo_failed" && <p className="error-text">{t(lang, "loc_geo_failed")}</p>}
          {locMsg === "loc_pair_error" && <p className="error-text">{t(lang, "loc_pair_error")}</p>}
          {locMsg === "loc_format_error" && <p className="error-text">{t(lang, "loc_format_error")}</p>}
          {locMsg === "" && latStr.trim() === "" && lngStr.trim() === "" && (
            <p className="hint" style={{ color: "var(--gold-ink)" }}>{t(lang, "loc_not_set")}</p>
          )}
        </div>

        {canManage && uploadError && <p className="error-text">{uploadError}</p>}
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
        {dirSaved === "ok" && <p className="hint" style={{ color: "var(--good-ink)", marginTop: 6 }}>{t(lang, "save_ok")}</p>}
        {dirSaved === "failed" && <p className="error-text" style={{ marginTop: 6 }}>{t(lang, "save_failed")}</p>}
      </form>

      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setSavingRules(true);
          const r = await saveBookingRules({
            businessHours: hours,
            slotIntervalMinutes: slotInterval,
            minNoticeMinutes: minNotice,
            maxAdvanceDays: maxAdvance,
          });
          setRulesSaved(r.ok ? "ok" : "failed");
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
        {rulesSaved === "ok" && <p className="hint" style={{ color: "var(--good-ink)", marginTop: 6 }}>{t(lang, "save_ok")}</p>}
        {rulesSaved === "failed" && <p className="error-text" style={{ marginTop: 6 }}>{t(lang, "save_failed")}</p>}
      </form>

      {canManage && <DangerZone lang={lang} />}
    </div>
  );
}

function DangerZone({ lang }: { lang: Lang }) {
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);

  return (
    <div className="card" style={{ borderColor: "var(--bad-ink)" }}>
      <p style={{ fontWeight: 700, color: "var(--bad-ink)", marginBottom: 4 }}>
        {t(lang, "danger_zone_title")}
      </p>
      <p className="hint" style={{ marginBottom: 12 }}>{t(lang, "close_org_hint")}</p>
      {!confirming ? (
        <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>
          {t(lang, "close_org_cta")}
        </button>
      ) : (
        <div>
          <p style={{ marginBottom: 10 }}>{t(lang, "close_org_confirm")}</p>
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              style={{ background: "var(--bad-ink)" }}
              disabled={closing}
              onClick={async () => {
                setClosing(true);
                await closeOrganization();
                window.location.href = "/auth/signout";
              }}
            >
              {closing ? t(lang, "loading") : t(lang, "close_org_confirm_cta")}
            </button>
            <button type="button" className="btn ghost" disabled={closing} onClick={() => setConfirming(false)}>
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
