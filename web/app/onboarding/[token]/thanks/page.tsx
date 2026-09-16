import { T } from "@/lib/design-tokens";
import { getT } from "@/lib/i18n-server";
import PublicLangToggle from "@/components/PublicLangToggle";

export default async function OnboardingThanks() {
  const t = await getT();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <PublicLangToggle />
      <div
        className="glass glass-tint-moss"
        data-testid="onboarding-thanks"
        style={{ borderRadius: T.radius.card, padding: 32, maxWidth: 420, textAlign: "center" }}
      >
        <div style={{ fontFamily: T.font.mono, fontSize: 22, marginBottom: 6 }}>{t("ob.thanksTitle")}</div>
        <div style={{ fontSize: 13, color: T.mutedMid }}>
          {t("ob.thanksBody")}
        </div>
      </div>
    </div>
  );
}
