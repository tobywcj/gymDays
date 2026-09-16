"use client";

import { useI18n } from "@/lib/i18n-context";
import { AFT_BY_KEY, type AftLevel } from "@/lib/exercise-library";

type Props = {
  level: AftLevel;
  name?: string | null;      // optional client name shown before the level
  size?: "sm" | "md";
  showWho?: boolean;         // append the "who it's for" line (md only)
};

// Canonical, aesthetic AFT level pill: a glowing colour dot + (optional) client
// name + the level name in a tinted inner chip. Reused on the Programme card,
// the clients table, and the client detail header.
export default function AftBadge({ level, name, size = "md", showWho }: Props) {
  const { locale } = useI18n();
  const lvl = AFT_BY_KEY[level];
  const label = locale === "zh" ? lvl.label.zh : lvl.label.en;
  const who = locale === "zh" ? lvl.who.zh : lvl.who.en;
  const sm = size === "sm";

  return (
    <span
      title={who}
      style={{
        display: "inline-flex", alignItems: "center", gap: sm ? 5 : 7,
        padding: sm ? "2px 10px" : "4px 13px",
        borderRadius: 99,
        // Partially-transparent fill of the level colour — softer than a solid
        // block (the saturated blue/red especially) while still reading as filled.
        background: `${lvl.color}d9`,
        border: `1px solid ${lvl.color}`,
        color: "#0c0f08",
        boxShadow: `0 2px 9px ${lvl.color}44`,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {name && <span style={{ fontSize: sm ? 10.5 : 11.5, fontWeight: 600, color: "rgba(0,0,0,0.62)", maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>}
      {name && <span style={{ opacity: 0.38, fontWeight: 400 }}>·</span>}
      <span style={{ fontSize: sm ? 10.5 : 12 }}>{label}</span>
      {showWho && !sm && <span style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(0,0,0,0.62)" }}>· {who}</span>}
    </span>
  );
}
