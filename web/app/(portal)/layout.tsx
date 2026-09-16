import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { supabaseServer } from "@/lib/supabase/server";
import PortalShell from "@/components/portal/PortalShell";

// The trainee-facing portal. Only clients land here — trainers are bounced to
// the dashboard (middleware enforces this too; this is defence in depth).
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (viewer.role === "none") redirect("/login");
  if (viewer.role !== "client") redirect("/");

  const supabase = await supabaseServer();
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", viewer.clientIds[0])
    .maybeSingle<{ name: string }>();

  return <PortalShell name={client?.name ?? viewer.email}>{children}</PortalShell>;
}
