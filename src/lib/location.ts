import "server-only";
import { cookies } from "next/headers";
import { GEO_COOKIE } from "@/lib/directory";

// The customer's rounded position, as NearMeBar stored it. Strictly
// validated: this cookie is client-writable, so anything that is not
// exactly "lat,lng" inside real-world ranges is treated as absent rather
// than fed into a distance sort measured from a place that does not
// exist. Absent, not (0,0) — missing is not zero.
export async function getGeo(): Promise<{ lat: number; lng: number } | null> {
  const raw = (await cookies()).get(GEO_COOKIE)?.value;
  if (!raw) return null;

  const m = raw.match(/^(-?\d{1,3}\.\d{1,6}),(-?\d{1,3}\.\d{1,6})$/);
  if (!m) return null;

  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}
