// Thin client for the Python AI service.
// Reads AI_SERVICE_URL (defaults to http://localhost:8001).
import { getLlmModel } from "@/lib/llm-server";

const BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

// Fall back to the globally-selected model (header picker → cookie) when a call
// site doesn't pass one explicitly. Server-only; safe inside route handlers.
async function resolveModel(explicit?: string): Promise<string | undefined> {
  return explicit || (await getLlmModel());
}

export type LLMCatalog = {
  default: string;
  models: Record<string, string>;
  keys: { openai: boolean; anthropic: boolean; google: boolean };
};

export async function listLLMs(trainerId?: string): Promise<LLMCatalog | null> {
  try {
    // Pass the trainer so availability reflects keys they entered on the API Keys
    // page (trainer_secrets), not just global .env keys.
    const qs = trainerId ? `?trainer_id=${encodeURIComponent(trainerId)}` : "";
    const r = await fetch(`${BASE}/llms${qs}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export type DesignedBattery = {
  battery: Array<{ test: string; rationale: string; contraindication_check?: string }>;
  skipped: Array<{ test: string; reason: string }>;
  blocked?: boolean;
  reason?: string;
};

export async function designFitnessTests(client_id: string): Promise<DesignedBattery | null> {
  try {
    const r = await fetch(`${BASE}/assessment/design/${client_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as DesignedBattery;
  } catch {
    return null;
  }
}

export async function runOnboarding(client_id: string, transcript: string, llm_model?: string) {
  const r = await fetch(`${BASE}/flows/onboarding/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript, llm_model: await resolveModel(llm_model) }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AI service responded ${r.status}: ${text}`);
  }
  return r.json() as Promise<{ client_id: string; summary: Record<string, unknown> }>;
}

export async function runPlanning(client_id: string, llm_model?: string) {
  const r = await fetch(`${BASE}/flows/planning/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ llm_model: await resolveModel(llm_model) }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AI service responded ${r.status}: ${text}`);
  }
  return r.json() as Promise<{ client_id: string; summary: Record<string, unknown> }>;
}

export type FlowName = "daily-reminder" | "weekly-checkin" | "post-session-nudge";

export async function runMessagingFlow(client_id: string, flow: FlowName, llm_model?: string) {
  const r = await fetch(`${BASE}/flows/${flow}/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ llm_model: await resolveModel(llm_model) }),
  });
  if (!r.ok) throw new Error(`AI service responded ${r.status}: ${await r.text()}`);
  return r.json() as Promise<{ client_id: string; summary: Record<string, unknown> }>;
}

// Fire-and-forget: ask the AI service to send a real-time post-workout refuel
// message. The endpoint returns 202 immediately and runs the flow in the
// background, so this resolves fast — safe to await inside the Strava webhook.
// Never throws; a failed nudge must not fail activity ingestion.
export async function triggerPostWorkoutAnalysis(client_id: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/flows/post-workout-analysis/${client_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export type MessagingProvidersCatalog = {
  providers: Record<string, { channel: string; available: boolean; reason: string | null }>;
};

export async function listMessagingProviders(trainerId?: string): Promise<MessagingProvidersCatalog | null> {
  try {
    // Pass the trainer so the service checks their saved DB credentials, not
    // just process env vars (the Connections card stores creds per-trainer).
    const qs = trainerId ? `?trainer_id=${encodeURIComponent(trainerId)}` : "";
    const r = await fetch(`${BASE}/messaging/providers${qs}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function sendMessage(client_id: string, body: string, provider?: string, subject?: string, to?: string) {
  const r = await fetch(`${BASE}/messaging/send/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body, provider, subject, to }),
  });
  if (!r.ok) {
    throw new Error(`AI service responded ${r.status}: ${await r.text()}`);
  }
  return r.json() as Promise<{
    client_id: string; message_id: string; status: string; channel: string; provider: string;
  }>;
}

export async function draftMessage(client_id: string, channel: string, brief?: string) {
  const r = await fetch(`${BASE}/messaging/draft/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, brief }),
  });
  if (!r.ok) {
    throw new Error(`AI service responded ${r.status}: ${await r.text()}`);
  }
  return r.json() as Promise<{ channel: string; body: string; subject: string | null }>;
}

export async function runProgress(client_id: string, llm_model?: string, days?: number, period_start?: string, period_end?: string) {
  const r = await fetch(`${BASE}/flows/progress/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ llm_model: await resolveModel(llm_model), days, period_start, period_end }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AI service responded ${r.status}: ${text}`);
  }
  return r.json() as Promise<{ client_id: string; summary: Record<string, unknown> }>;
}

export type AftLevel = "blue" | "green" | "yellow" | "orange" | "red";
export type AftClassification = {
  level: AftLevel;
  rationale: string | null;
  signals: { label: string; value: string }[];
  classified_at: string | null;
};

export async function runAftClassification(client_id: string, llm_model?: string) {
  const r = await fetch(`${BASE}/flows/aft-classification/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ llm_model: await resolveModel(llm_model) }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AI service responded ${r.status}: ${text}`);
  }
  return r.json() as Promise<AftClassification>;
}

export type ScreeningReadiness = {
  verdict: "ready" | "alert";
  rationale: string | null;
  flags: { label: string; value: string }[];
  checked_at: string | null;
};

// Pre-training readiness check: the agent weighs the client's live injury status,
// chronic conditions, medications, PAR-Q / CVD flags, and clearance gates into a
// single "ready"/"alert" verdict. Ephemeral — computed fresh on each call.
export async function runScreeningReadiness(client_id: string, llm_model?: string) {
  const r = await fetch(`${BASE}/flows/screening-readiness/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ llm_model: await resolveModel(llm_model) }),
    cache: "no-store",
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AI service responded ${r.status}: ${text}`);
  }
  return r.json() as Promise<ScreeningReadiness>;
}

export async function runNutrition(client_id: string, llm_model?: string) {
  const r = await fetch(`${BASE}/flows/nutrition/${client_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ llm_model: await resolveModel(llm_model) }),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`AI service responded ${r.status}: ${text}`);
  }
  return r.json() as Promise<{ client_id: string; summary: Record<string, unknown> }>;
}
