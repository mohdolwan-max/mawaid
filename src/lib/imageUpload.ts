import { t, type Lang } from "@/lib/i18n";

// Shared by every client-side image upload in the (app) owner shell
// (org cover/logo in Settings, per-service photos) — "accept=image/*"
// on the <input> is only a UI hint, never real enforcement, so this is
// the actual gate before calling storage.upload(). The org-media
// bucket itself also enforces the same limits server-side (see
// 0018_org_media_upload_limits.sql) as defense in depth.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateImageFile(file: File, lang: Lang): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return t(lang, "upload_invalid_type");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return t(lang, "upload_too_large");
  }
  return null;
}
