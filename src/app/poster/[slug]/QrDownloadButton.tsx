"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { t, type Lang } from "@/lib/i18n";
import { QR_LOGO_FRACTION } from "@/lib/qr";

// The code alone, as a large PNG, for the clinic's own designs (menus,
// business cards, Instagram). Drawn in the browser from the same link and
// settings as the poster, with the same symbol in the middle.
const SIZE = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function QrDownloadButton({ lang, url, slug }: { lang: Lang; url: string; slug: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const canvas = document.createElement("canvas");
      await QRCode.toCanvas(canvas, url, {
        width: SIZE,
        margin: 2,
        errorCorrectionLevel: "H",
        color: { dark: "#0d3b3b", light: "#ffffff" },
      });
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      const box = Math.round(canvas.width * QR_LOGO_FRACTION);
      const x = Math.round((canvas.width - box) / 2);
      // A white rounded tile behind the symbol, so it reads as a badge on
      // the code rather than as damage to it.
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.roundRect(x, x, box, box, box * 0.18);
      ctx.fill();
      const logo = await loadImage("/brand/splash-symbol.webp");
      const pad = box * 0.1;
      ctx.drawImage(logo, x + pad, x + pad, box - pad * 2, box - pad * 2);
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("no blob");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `maw3ed-qr-${slug}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      console.error("QR download failed", e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void download()}>
        {busy ? t(lang, "loading") : t(lang, "qr_download")}
      </button>
      {failed && <span className="error-text">{t(lang, "error_generic")}</span>}
    </>
  );
}
