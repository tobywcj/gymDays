import { T } from "@/lib/design-tokens";
import ClientTable from "@/components/dashboard/ClientTable";
import { supabaseServer } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n-server";
import type { ClientRow, ClientView } from "@/lib/types";

export const dynamic = "force-dynamic";

function toView(row: ClientRow): ClientView {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal ?? "—",
    lastSession: "—", // wired in M6 (Strava ingest)
    strava: !!row.strava_athlete_id,
    status: row.status,
    aftLevel: row.aft_level ?? null,
  };
}

export default async function ClientsPage() {
  const supabase = await supabaseServer();
  const t = await getT();

  const { data } = await supabase
    .from("clients")
    .select("id, trainer_id, name, goal, strava_athlete_id, status, created_at, aft_level")
    .order("created_at", { ascending: false })
    .returns<ClientRow[]>();

  const clients = (data ?? []).map(toView);

  return (
    <div style={{ padding: "22px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="glass" style={{ borderRadius: T.radius.card, padding: 24, flexShrink: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("nav.clients")}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>{clients.length} {t("metric.onRoster")}</div>
      </div>

      <ClientTable clients={clients} showViewAll={false} />
    </div>
  );
}
