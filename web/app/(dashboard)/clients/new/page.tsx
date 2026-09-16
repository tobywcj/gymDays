import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { T } from "@/lib/design-tokens";
import { getT } from "@/lib/i18n-server";
import InviteShareCard from "@/components/dashboard/InviteShareCard";

async function createClient(formData: FormData) {
  "use server";
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || null;
  const goal = String(formData.get("goal") ?? "").trim() || null;
  const telegramHandle = String(formData.get("telegram_handle") ?? "").trim() || null;

  if (!name) throw new Error("Name required.");

  const { data: client, error } = await supabase
    .from("clients")
    .insert({
      trainer_id: user.id,
      name,
      email,
      goal,
      profile: telegramHandle ? { telegram_handle: telegramHandle } : {},
    })
    .select("id")
    .single();
  if (error || !client) throw new Error(error?.message ?? "insert failed");

  const token = randomBytes(24).toString("base64url");
  const expires_at = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { error: invErr } = await supabase
    .from("onboarding_invites")
    .insert({ trainer_id: user.id, client_id: client.id, token, expires_at });
  if (invErr) throw new Error(invErr.message);

  revalidatePath("/");
  redirect(`/clients/new?invited=${client.id}&token=${token}`);
}

type Props = { searchParams: Promise<{ invited?: string; token?: string }> };

export default async function NewClientPage({ searchParams }: Props) {
  const params = await searchParams;
  const showInvite = params.invited && params.token;

  // Build absolute URL for the invite (used by QR + Telegram share).
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const inviteUrl = showInvite ? `${proto}://${host}/onboarding/${params.token}` : null;

  // Look up the optional telegram_handle the trainer entered when creating the client.
  let telegramHandle: string | null = null;
  if (showInvite && params.invited) {
    const supabase = await supabaseServer();
    const { data } = await supabase
      .from("clients")
      .select("profile, name")
      .eq("id", params.invited)
      .maybeSingle();
    telegramHandle = (data?.profile as { telegram_handle?: string } | null)?.telegram_handle ?? null;
  }

  const t = await getT();

  return (
    <div style={{ padding: "22px 28px", overflowY: "auto", flex: 1 }}>
      <div
        className="glass"
        style={{
          borderRadius: T.radius.card,
          padding: 28,
          maxWidth: 560,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{t("topbar.addClient")}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {t("nc.subtitle")}
          </div>
        </div>

        {showInvite && inviteUrl ? (
          <InviteShareCard url={inviteUrl} telegramHandle={telegramHandle} />
        ) : (
          <form action={createClient} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field name="name" label={t("nc.name")} required testId="name" />
            <Field name="email" label={t("nc.email")} type="email" testId="email" />
            <Field name="goal" label={t("nc.goal")} placeholder={t("nc.goalPlaceholder")} testId="goal" />
            <Field
              name="telegram_handle"
              label={t("nc.telegram")}
              placeholder="janedoe"
              testId="telegram_handle"
            />
            <button
              type="submit"
              data-testid="create"
              style={{
                alignSelf: "flex-start",
                background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
                border: "1px solid rgba(255,252,245,0.25)",
                borderRadius: 99,
                padding: "9px 18px",
                color: "#fffdf6",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(140,92,48,0.45)",
              }}
            >
              {t("nc.create")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  placeholder,
  testId,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  testId?: string;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: T.muted }}>
      {label}
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        data-testid={testId}
        style={{
          background: "rgba(0,0,0,0.25)",
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          padding: "10px 12px",
          color: T.text,
          fontSize: 13,
          outline: "none",
        }}
      />
    </label>
  );
}
