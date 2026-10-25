// Rooms and devices (0068): shapes, parsing and the one rule the editor
// needs. Free of React and the database so it can be tested directly
// (ENGINEERING-STANDARDS §4).

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const RESOURCE_NAME_MAX = 60;
export const RESOURCE_CAPACITY_MAX = 20;

export type ResourceKind = "room" | "device";

export type Resource = {
  id: string;
  name: string;
  kind: ResourceKind;
  /** How many visits it holds at once (two identical rooms = 2). */
  capacity: number;
  /** The services that need it. */
  serviceIds: string[];
};

export function parseResources(raw: unknown): Resource[] {
  const out: Resource[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.id !== "string" || typeof r.name !== "string") continue;
    const capacity = Number(r.capacity);
    out.push({
      id: r.id,
      name: r.name,
      kind: r.kind === "room" ? "room" : "device",
      capacity: Number.isInteger(capacity) && capacity > 0 ? capacity : 1,
      serviceIds: Array.isArray(r.service_ids) ? r.service_ids.filter((x): x is string => typeof x === "string") : [],
    });
  }
  return out;
}

export type ResourceInputError = "res_err_name" | "res_err_capacity";

export function checkResourceInput(input: { name: string; capacity: string }): ResourceInputError | null {
  const name = input.name.trim();
  if (name.length < 1 || name.length > RESOURCE_NAME_MAX) return "res_err_name";
  const c = Number(input.capacity);
  if (!Number.isInteger(c) || c < 1 || c > RESOURCE_CAPACITY_MAX) return "res_err_capacity";
  return null;
}

/** The database keeps what each SERVICE needs (set_service_resources);
 *  the editor picks the services for one resource. This turns the one
 *  into the other: for every service whose needs change, its new full
 *  list. Services that do not change are left out, so nothing is
 *  rewritten that the editor did not touch. */
export function serviceNeedsAfter(
  resources: readonly Resource[],
  resourceId: string,
  chosenServiceIds: readonly string[]
): { serviceId: string; resourceIds: string[] }[] {
  const chosen = new Set(chosenServiceIds);
  const needs = new Map<string, Set<string>>();
  for (const r of resources) {
    for (const s of r.serviceIds) {
      if (!needs.has(s)) needs.set(s, new Set());
      needs.get(s)!.add(r.id);
    }
  }
  const touched = new Set<string>([...chosen, ...(resources.find((r) => r.id === resourceId)?.serviceIds ?? [])]);
  const out: { serviceId: string; resourceIds: string[] }[] = [];
  for (const s of touched) {
    const before = needs.get(s) ?? new Set<string>();
    const after = new Set(before);
    if (chosen.has(s)) after.add(resourceId);
    else after.delete(resourceId);
    const same = before.size === after.size && [...before].every((x) => after.has(x));
    if (!same) out.push({ serviceId: s, resourceIds: [...after].sort() });
  }
  return out.sort((a, b) => a.serviceId.localeCompare(b.serviceId));
}
