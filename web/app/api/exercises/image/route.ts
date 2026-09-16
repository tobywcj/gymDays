import { NextResponse, type NextRequest } from "next/server";
import { resolveExerciseImage } from "@/lib/exercise-images";

// Resolve a demonstration photo for an exercise name (free-exercise-db). Used by
// the import panel to preview a photo for a researched candidate before it's
// saved. Lives server-side so the ~100KB index never ships to the client.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const mg = req.nextUrl.searchParams.get("mg");
  if (!name) return NextResponse.json({ url: null, alt: null });
  const img = resolveExerciseImage(name, mg);
  return NextResponse.json({ url: img?.url ?? null, alt: img?.alt ?? null });
}
