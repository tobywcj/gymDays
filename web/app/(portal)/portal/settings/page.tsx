import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { getT } from "@/lib/i18n-server";
import { T } from "@/lib/design-tokens";
import MfaPanel from "@/components/auth/MfaPanel";

export const dynamic = "force-dynamic";

export default async function PortalSettings() {
  const viewer = await getViewer();
  if (viewer.role !== "client") redirect("/");
  const t = await getT();

  return (
    <>
      <div className="glass" style={{ borderRadius: T.radius.card, padding: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("mfa.title")}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4, lineHeight: 1.5 }}>{t("mfa.intro")}</div>
      </div>
      <MfaPanel />
    </>
  );
}
