// Dev-only: insert sample activities for a client so the UI can be exercised
// without setting up a real Strava developer app.
//
//   POST /api/strava/dev-seed/<client_id>
//
// Inserts 5 mocked activities (latest = today) under source='strava-dev'.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ client_id: string }> }) {
  const { client_id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: client } = await supabase
    .from("clients").select("id, trainer_id").eq("id", client_id).maybeSingle();
  if (!client) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const now = new Date();
  const samples = [
    { offsetDays: 0,  type: "Run",           name: "Morning easy run",    distance_m: 6200,  duration_s: 1980, hr: 142, elev: 48,  suffer: 42,  kcal: 420  },
    { offsetDays: 1,  type: "Ride",          name: "Coastal spin",        distance_m: 32400, duration_s: 5400, hr: 138, elev: 210, suffer: 68,  kcal: 890  },
    { offsetDays: 3,  type: "Run",           name: "Tempo intervals",     distance_m: 8500,  duration_s: 2520, hr: 168, elev: 62,  suffer: 112, kcal: 610  },
    { offsetDays: 5,  type: "Swim",          name: "Pool drills",         distance_m: 1500,  duration_s: 1800, hr: 122, elev: 0,   suffer: 28,  kcal: 310  },
    { offsetDays: 7,  type: "Run",           name: "Long Sunday run",     distance_m: 18400, duration_s: 6600, hr: 148, elev: 195, suffer: 156, kcal: 1240 },
    { offsetDays: 9,  type: "WeightTraining",name: "Upper body strength", distance_m: 0,     duration_s: 3600, hr: 131, elev: 0,   suffer: 55,  kcal: 380  },
    { offsetDays: 11, type: "Run",           name: "Recovery jog",        distance_m: 4800,  duration_s: 1740, hr: 128, elev: 22,  suffer: 24,  kcal: 310  },
    { offsetDays: 14, type: "Ride",          name: "Hill repeats",        distance_m: 28000, duration_s: 4800, hr: 162, elev: 640, suffer: 134, kcal: 1050 },
    { offsetDays: 16, type: "WeightTraining",name: "Leg day",             distance_m: 0,     duration_s: 3300, hr: 136, elev: 0,   suffer: 62,  kcal: 420  },
    { offsetDays: 18, type: "Run",           name: "Fartlek",             distance_m: 10200, duration_s: 2880, hr: 158, elev: 88,  suffer: 98,  kcal: 720  },
  ];

  const rows = samples.map((s, i) => {
    const started = new Date(now.getTime() - s.offsetDays * 24 * 60 * 60 * 1000);
    return {
      trainer_id: client.trainer_id,
      client_id: client.id,
      source: "strava-dev",
      external_id: `dev-${client.id}-${i}-${started.toISOString().slice(0, 10)}`,
      started_at: started.toISOString(),
      type: s.type,
      distance_m: s.distance_m,
      duration_s: s.duration_s,
      metrics: {
        name: s.name,
        average_heartrate: s.hr,
        total_elevation_gain: s.elev,
        suffer_score: s.suffer,
        calories: s.kcal,
      },
    };
  });

  const admin = supabaseAdmin();
  await admin.from("activities").delete().eq("client_id", client.id).eq("source", "strava-dev");
  await admin.from("activities").insert(rows);

  return NextResponse.json({ inserted: rows.length });
}
