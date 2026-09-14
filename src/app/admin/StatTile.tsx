// A KPI as a number, not a chart (dataviz: a single headline value is a
// stat tile). Status tones always travel with their label text, never as
// color alone.
export function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string | null;
  /** Only for counts that ask for action: a refund owed, a failure. */
  tone?: "warn" | "bad" | null;
}) {
  return (
    <div className={`admin-tile${tone ? ` ${tone}` : ""}`}>
      <p className="at-label">{label}</p>
      <p className="at-value">{value}</p>
      {sub && <p className="at-sub">{sub}</p>}
    </div>
  );
}
