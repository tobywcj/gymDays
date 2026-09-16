import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getViewer } from "@/lib/auth/viewer";
import { getT } from "@/lib/i18n-server";
import { T } from "@/lib/design-tokens";
import InsightTree from "@/components/portal/InsightTree";

export default async function PortalInsights() {
  const viewer = await getViewer();
  if (viewer.role !== "client") redirect("/");
  const t = await getT();

  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients")
    .select("name, goal")
    .eq("id", viewer.clientIds[0])
    .maybeSingle<{ name: string; goal: string | null }>();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>{t("insight.title")}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{t("insight.subtitle")}</div>
      </div>

      <InsightTree clientName={client?.name ?? ""} clientGoal={client?.goal ?? null} />
    </div>
  );
}
