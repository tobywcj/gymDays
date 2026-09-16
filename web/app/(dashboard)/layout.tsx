import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { listLLMs } from "@/lib/ai-service";
import { getLlmModel } from "@/lib/llm-server";
import type { Trainer } from "@/lib/types";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trainer } = await supabase
    .from("trainers")
    .select("id, email, full_name")
    .eq("id", user.id)
    .single<Trainer>();

  // First-login race: auth.users trigger should have inserted the row, but
  // fall back to client-side identity if not yet present.
  const trainerInfo: Trainer = trainer ?? {
    id: user.id,
    email: user.email ?? "",
    full_name: null,
  };

  // Global AI model picker lives in the header — fetch the catalog once here and
  // resolve the current selection (cookie → catalog default) for the whole shell.
  // Pass the trainer so models they added a key for (API Keys page) show enabled.
  const [llmCatalog, cookieModel] = await Promise.all([listLLMs(user.id), getLlmModel()]);
  const llmModel = cookieModel ?? llmCatalog?.default ?? "";

  return (
    <DashboardShell trainer={trainerInfo} llmCatalog={llmCatalog} llmModel={llmModel}>
      {children}
    </DashboardShell>
  );
}
