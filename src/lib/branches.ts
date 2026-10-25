// Branches (0071): every branch is a complete clinic under one owner
// account, which switches between them. Shapes and the slug rule the form
// checks before the database does. Free of React and the database so it
// can be tested directly (ENGINEERING-STANDARDS §4).

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export type MyOrg = { orgId: string; name: string; slug: string; role: "owner" | "staff"; city: string | null; active: boolean };

export function parseMyOrgs(raw: unknown): MyOrg[] {
  const out: MyOrg[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.org_id !== "string" || typeof r.slug !== "string") continue;
    out.push({
      orgId: r.org_id,
      name: typeof r.name === "string" && r.name !== "" ? r.name : r.slug,
      slug: r.slug,
      role: r.role === "owner" ? "owner" : "staff",
      city: typeof r.city === "string" ? r.city : null,
      active: r.is_active === true,
    });
  }
  return out;
}

export type BranchLine = {
  orgId: string;
  name: string;
  slug: string;
  currency: string;
  visits: number;
  completed: number;
  noShows: number;
  value: number;
  unpriced: number;
};

export function parseBranchSummary(raw: unknown): BranchLine[] {
  const out: BranchLine[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.org_id !== "string") continue;
    out.push({
      orgId: r.org_id,
      name: typeof r.name === "string" ? r.name : "",
      slug: typeof r.slug === "string" ? r.slug : "",
      currency: typeof r.currency === "string" ? r.currency : "JOD",
      visits: num(r.visits),
      completed: num(r.completed),
      noShows: num(r.no_shows),
      value: num(r.value),
      unpriced: num(r.unpriced),
    });
  }
  return out;
}

/** Totals per currency: a JOD clinic and a SAR clinic are never summed. */
export function branchTotals(lines: readonly BranchLine[]): { currency: string; visits: number; completed: number; value: number }[] {
  const by = new Map<string, { currency: string; visits: number; completed: number; value: number }>();
  for (const l of lines) {
    const t = by.get(l.currency) ?? { currency: l.currency, visits: 0, completed: 0, value: 0 };
    t.visits += l.visits;
    t.completed += l.completed;
    t.value += l.value;
    by.set(l.currency, t);
  }
  return [...by.values()];
}

/** The same shape create_organization accepts, so the form can say so
 *  before the round trip: lower-case letters, digits and inner hyphens. */
export function slugOk(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(slug.trim().toLowerCase());
}
