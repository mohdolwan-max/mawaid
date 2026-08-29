"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import type { Service } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { validateImageFile } from "@/lib/imageUpload";
import { addService, toggleServiceActive, deleteService, saveServicePhoto } from "./actions";

export function ServicesClient({
  lang,
  services,
  orgId,
  canManage,
}: {
  lang: Lang;
  services: Service[];
  orgId: string;
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
        <div className="services-grid">
          {services.map((s) => (
            <ServiceCard key={s.id} lang={lang} service={s} orgId={orgId} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceCard({
  lang,
  service,
  orgId,
  canManage,
}: {
  lang: Lang;
  service: Service;
  orgId: string;
  canManage: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setUploadError(null);
    const validationError = validateImageFile(file, lang);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${orgId}/service-${service.id}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("org-media").upload(path, file, { upsert: true });
      if (error) throw error;
      const { data } = supabase.storage.from("org-media").getPublicUrl(path);
      await saveServicePhoto(service.id, data.publicUrl);
      // revalidatePath() inside the server action alone doesn't reliably
      // repaint a route reached via a plain onClick (not a <form
      // action>/useActionState) — same class of bug as the sidebar
      // language toggle earlier; router.refresh() is the fix there too.
      router.refresh();
    } catch {
      setUploadError(t(lang, "error_sub"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="service-card">
      <div className="service-card-photo">
        {service.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
          <img src={service.photo_url} alt="" />
        )}
        {canManage && (
          <button
            type="button"
            className="btn ghost sm service-card-photo-btn"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? t(lang, "uploading") : t(lang, "upload_image")}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      <div className="service-card-body">
        <strong>{service.name}</strong>
        <p className="hint">
          {service.duration_minutes} {t(lang, "minutes")}
        </p>
        {uploadError && <p className="error-text">{uploadError}</p>}
        <div className="toolbar" style={{ justifyContent: "space-between", marginTop: 8 }}>
          <span className="num">{service.price != null ? `${service.price} ${t(lang, "currency")}` : "—"}</span>
          <span className={`chip ${service.active ? "good" : "neutral"}`}>
            {t(lang, service.active ? "active" : "inactive")}
          </span>
        </div>
        {canManage && (
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button
              className="btn ghost sm"
              onClick={async () => {
                await toggleServiceActive(service.id, !service.active);
                router.refresh();
              }}
            >
              {t(lang, service.active ? "inactive" : "active")}
            </button>
            <button
              className="btn danger sm"
              onClick={async () => {
                await deleteService(service.id);
                router.refresh();
              }}
            >
              {t(lang, "delete")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
