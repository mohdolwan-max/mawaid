import { t, type Lang } from "@/lib/i18n";

// Shared by every client-side image upload in the (app) owner shell
// (org cover/logo in Settings, per-service photos). "accept=image/*" on
// the <input> is only a UI hint, never real enforcement, so this is the
// actual gate before calling storage.upload(). The org-media bucket also
// enforces type and a 5MB ceiling server-side (0018) as defence in depth.
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

// What may be STORED. Nothing should ever get near this after
// downscaleImage(), which is the point — the cap is a backstop, not the
// mechanism that keeps pages fast.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// What may be picked. A photo straight off a modern phone is routinely
// 4-12MB; rejecting those would be user-hostile when we are about to
// shrink them anyway. The ceiling only exists so a truly absurd file
// cannot make the browser run out of memory while decoding it.
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

// Longest-edge budgets. These are display sizes, not archival ones: a
// cover renders ~170px tall in a card and a logo 56px, so anything
// larger is bytes the customer downloads and never sees. Mobile data in
// Jordan is the common case, so this matters more than storage cost.
export const MAX_DIM = { cover: 1600, logo: 400, service: 800 } as const;

export function validateImageFile(file: File, lang: Lang): string | null {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return t(lang, "upload_invalid_type");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return t(lang, "upload_too_large");
  }
  return null;
}

// Re-encodes to WebP at a sane display size. A 4MB phone photo typically
// lands around 100-250KB, which is the difference between a clinic page
// that loads instantly on mobile data and one that visibly crawls.
//
// Every failure path deliberately returns the ORIGINAL file rather than
// throwing: a browser too old for createImageBitmap, a decode failure, a
// canvas that is tainted or out of memory. Uploading a large image is
// worse than uploading a small one, but far better than an owner being
// unable to upload at all.
export async function downscaleImage(file: File, maxDim: number): Promise<File> {
  if (typeof createImageBitmap !== "function") return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, maxDim / longest);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82)
    );
    // Re-encoding a small, already-optimised image can come out bigger;
    // keep whichever is actually smaller.
    if (!blob || blob.size >= file.size) return file;

    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.webp`, { type: "image/webp" });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
