import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Keep these allowlists in sync with the AI service (ai/crew/agents.py
// SOURCE_TOOLS) and the frontend map (components/dashboard/AgentKnowledgeMap.tsx).
const AGENTS = new Set(["planner", "progress", "nutrition", "concierge", "messaging", "exercise"]);
const SOURCES = new Set([
  "profile", "screening", "inbody", "workouts", "program",
  "progress", "memory", "knowledge", "food", "exercises", "web",
]);

type Prefs = Record<string, Record<string, boolean>>;

// Validate + normalise: keep only known agents/sources and their explicit
// on/off overrides (the client sends only values that differ from an agent's
// default, so the blob stays small). The AI service reads these the same way.
function sanitise(input: unknown): Prefs {
  const out: Prefs = {};
  if (!input || typeof input !== "object") return out;
  for (const [agent, sources] of Object.entries(input as Record<string, unknown>)) {
    if (!AGENTS.has(agent) || !sources || typeof sources !== "object") continue;
    const over: Record<string, boolean> = {};
    for (const [source, on] of Object.entries(sources as Record<string, unknown>)) {
      if (SOURCES.has(source) && typeof on === "boolean") over[source] = on;
    }
    if (Object.keys(over).length) out[agent] = over;
  }
  return out;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { prefs?: unknown };
  const prefs = sanitise(body.prefs);

  const { error } = await supabase
    .from("clients")
    .update({ agent_source_prefs: prefs })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id, agent_source_prefs: prefs });
}
