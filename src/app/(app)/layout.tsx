import { requireOrgContext } from "@/lib/org";
import { Sidebar } from "./Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();

  return (
    <div className="app">
      <Sidebar lang={ctx.lang} orgName={ctx.name} />
      <main className="main">{children}</main>
    </div>
  );
}
