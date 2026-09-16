// Proxies an SSE stream from the Python AI service back to the browser.
// The caller is responsible for auth-checking the client first.
import { getLlmModel } from "@/lib/llm-server";

const BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

export async function proxyAgentStream(
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  // Resolve the global model from the cookie unless the caller set one — every
  // AI feature honours the header selection without re-sending it per request.
  const outgoing = { ...body };
  if (!outgoing.llm_model) outgoing.llm_model = await getLlmModel();

  const upstream = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(outgoing),
    // @ts-expect-error Next.js fetch supports duplex for streaming
    duplex: "half",
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(`AI service ${upstream.status}: ${text}`, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
