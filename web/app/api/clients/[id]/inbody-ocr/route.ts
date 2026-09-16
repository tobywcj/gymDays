import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8001";

// Proxies a photographed InBody / BIA sheet to the AI service for OCR.
// Client-scoped sibling of the first-lesson route, used by the standalone
// "log a reading" form. Returns { machine, mapped, extra }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params; // OCR itself is client-agnostic; grouped under [id] for parity
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no image uploaded" }, { status: 400 });
  }

  const upstream = new FormData();
  upstream.append("file", file, file.name || "inbody.jpg");

  let res: Response;
  try {
    res = await fetch(`${AI_BASE}/ocr/inbody`, { method: "POST", body: upstream });
  } catch {
    return NextResponse.json({ error: "AI service unreachable" }, { status: 502 });
  }

  const json = await res.json().catch(() => ({ error: `ocr failed (${res.status})` }));
  if (!res.ok) {
    const detail = (json as { detail?: string; error?: string }).detail
      ?? (json as { error?: string }).error
      ?? `ocr failed (${res.status})`;
    return NextResponse.json({ error: detail }, { status: res.status });
  }
  return NextResponse.json(json);
}
