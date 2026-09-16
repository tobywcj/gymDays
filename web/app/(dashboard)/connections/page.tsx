import Link from "next/link";
import { T } from "@/lib/design-tokens";
import { getT } from "@/lib/i18n-server";
import ConnectionsPanel from "@/components/dashboard/ConnectionsPanel";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const t = await getT();
  return (
    <div style={{ padding: "22px 28px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
      <Link href="/" style={{ fontSize: 11, color: T.accent }}>{t("conn.backToDashboard")}</Link>

      <div className="glass" style={{ borderRadius: T.radius.card, padding: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{t("conn.title")}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
          {t("conn.introPre")}
          <code style={{ fontFamily: T.font.mono, color: T.accent, margin: "0 4px" }}>.env</code>{t("conn.introPost")}
        </div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 10, lineHeight: 1.5 }}>
          <strong style={{ color: T.mutedMid }}>{t("conn.tgName")}</strong> {t("conn.tgPre")}{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: T.accent }}>@BotFather</a>{t("conn.tgMid")}<code style={{ fontFamily: T.font.mono, color: T.accent }}>cd telegram-bridge &amp;&amp; npm start</code>{t("conn.tgPost")}
        </div>
      </div>

      <ConnectionsPanel />
    </div>
  );
}
