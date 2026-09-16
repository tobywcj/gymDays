// Resolves who the current logged-in user is: a trainer (dashboard) or a
// client (read-only portal). A client may map to several client rows when
// they train under more than one trainer.
import { supabaseServer } from "@/lib/supabase/server";

export type Viewer =
  | { role: "none" }
  | { role: "trainer"; userId: string; email: string }
  | {
      role: "client";
      userId: string;
      email: string;
      clientIds: string[];
    };

export async function getViewer(): Promise<Viewer> {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { role: "none" };

  // RLS (clients_self_read) limits this to the user's own client rows.
  const { data: clients } = await supabase
    .from("clients")
    .select("id")
    .eq("auth_user_id", user.id);

  if (clients && clients.length > 0) {
    return {
      role: "client",
      userId: user.id,
      email: user.email ?? "",
      clientIds: clients.map((c) => c.id as string),
    };
  }

  return { role: "trainer", userId: user.id, email: user.email ?? "" };
}
