import Link from "next/link";
import { T } from "@/lib/design-tokens";
import { getT } from "@/lib/i18n-server";
import SecretsPanel from "@/components/dashboard/SecretsPanel";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const t = await getT();
  return (
    <div style={{ padding: "22px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <Link href="/" style={{ fontSize: 11, color: T.accent }}>{t("conn.backToDashboard")}</Link>

      <div className="glass" style={{ borderRadius: T.radius.card, padding: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("secrets.title")}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4, lineHeight: 1.5 }}>{t("secrets.intro")}</div>
      </div>

      <SecretsPanel />
    </div>
  );
}
