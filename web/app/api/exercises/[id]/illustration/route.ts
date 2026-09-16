import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateIllustration, type IllustrationProviderId } from "@/lib/exercise-illustration";
import { getTrainerSecrets } from "@/lib/trainer-secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // image gen can take a while

const BUCKET = "exercise-illustrations";
const VALID: IllustrationProviderId[] = ["cloudflare", "huggingface", "pollinations", "openai"];

// Trainer-only: generate an AI anatomical illustration for one exercise using
// the chosen provider, store it in the public bucket, and set illustration_url.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: trainer } = await supabase.from("trainers").select("id").eq("id", user.id).maybeSingle();
  if (!trainer) return NextResponse.json({ error: "trainer_not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const provider = body?.provider as IllustrationProviderId;
  if (!VALID.includes(provider)) return NextResponse.json({ error: "bad_provider" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: ex } = await admin
    .from("exercise_db")
    .select("id, name, muscle_group, primary_muscles, secondary_muscles, cues, equipment")
    .eq("id", id).maybeSingle();
  if (!ex) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const secrets = await getTrainerSecrets(supabase, user.id);

  let img;
  try {
    img = await generateIllustration(provider, ex, secrets);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const path = `${id}`;
  const up = await admin.storage.from(BUCKET).upload(path, img.bytes, { contentType: img.contentType, upsert: true });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  // Cache-bust so the <img> refreshes after a regenerate (stable storage path).
  const base = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const url = `${base}?v=${Date.now()}`;

  const { error: ue } = await admin.from("exercise_db").update({ illustration_url: url }).eq("id", id);
  if (ue) return NextResponse.json({ error: ue.message }, { status: 500 });

  return NextResponse.json({ url });
}
