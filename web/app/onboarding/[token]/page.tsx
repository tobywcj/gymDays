import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { T } from "@/lib/design-tokens";
import { getT } from "@/lib/i18n-server";
import PublicLangToggle from "@/components/PublicLangToggle";
import ScreeningStepper from "@/components/onboarding/ScreeningStepper";

// Public Supabase client (anon key, no session) — used for invite RPCs.
async function anonClient() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return store.getAll(); },
        setAll() {},
      },
    },
  );
}

type InviteRow = {
  client_id: string;
  client_name: string;
  trainer_name: string | null;
  expires_at: string;
};

type Props = { params: Promise<{ token: string }> };

export default async function OnboardingPage({ params }: Props) {
  const { token } = await params;
  const supabase = await anonClient();
  const { data, error } = await supabase.rpc("invite_lookup", { p_token: token });

  const invite = (data as InviteRow[] | null)?.[0];
  const t = await getT();

  if (error || !invite) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <PublicLangToggle />
        <div
          className="glass"
          data-testid="invite-expired"
          style={{ borderRadius: T.radius.card, padding: 32, maxWidth: 420, textAlign: "center" }}
        >
          <div style={{ fontFamily: T.font.mono, fontSize: 22, marginBottom: 6 }}>410</div>
          <div style={{ fontSize: 13, color: T.mutedMid }}>
            {t("ob.expired")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <PublicLangToggle />
      <ScreeningStepper
        token={token}
        clientName={invite.client_name}
        trainerName={invite.trainer_name}
      />
    </div>
  );
}
