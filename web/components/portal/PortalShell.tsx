"use client";

import Link from "next/link";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import AppLanguageToggle from "@/components/dashboard/AppLanguageToggle";

type Props = {
  name: string;
  children: React.ReactNode;
};

export default function PortalShell({ name, children }: Props) {
  const { t } = useI18n();
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "18px 24px",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <div>
          <div style={{ fontFamily: T.font.mono, fontSize: 18, letterSpacing: "-0.02em" }}>
            {t("portal.title")}
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
            {t("portal.greeting")} {name} — {t("portal.subtitle")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AppLanguageToggle />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              style={{
                border: `1px solid ${T.border}`,
                background: "transparent",
                borderRadius: T.radius.pill,
                padding: "6px 14px",
                color: T.mutedMid,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {t("portal.signout")}
            </button>
          </form>
        </div>
      </header>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontSize: 12,
          color: T.muted,
          padding: "8px 24px",
          borderBottom: `1px solid ${T.border}`,
        }}
      >
        <nav style={{ display: "flex", gap: 14 }}>
          <Link href="/portal" style={{ color: T.mutedMid, textDecoration: "none" }}>{t("portal.navHome")}</Link>
          <Link href="/portal/insights" style={{ color: T.mutedMid, textDecoration: "none" }}>{t("portal.navInsights")}</Link>
          <Link href="/portal/programme" style={{ color: T.mutedMid, textDecoration: "none" }}>{t("nav.programme")}</Link>
          <Link href="/portal/settings" style={{ color: T.mutedMid, textDecoration: "none" }}>{t("portal.navSettings")}</Link>
        </nav>
        <span style={{ marginLeft: "auto", fontSize: 11 }}>{t("portal.readonly")}</span>
      </div>

      <main
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "22px 24px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ maxWidth: 1200, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
          {children}
        </div>
      </main>
    </div>
  );
}
