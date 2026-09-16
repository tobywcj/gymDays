"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import type { AgentType } from "@/lib/mock";

const map: Record<AgentType, { bg: string; color: string }> = {
  Progress:      { bg: "rgba(196,148,82,0.20)",  color: "#e4c08c" },
  "Strava Sync": { bg: "rgba(196,108,76,0.20)",  color: "#e89878" },
  Reminder:      { bg: "rgba(140,164,140,0.22)", color: "#bcd3b8" },
  Research:      { bg: "rgba(122,148,124,0.22)", color: "#b4cebc" },
};

export default function AgentBadge({ type }: { type: AgentType }) {
  const { t } = useI18n();
  const s = map[type];
  return (
    <span
      style={{
        display: "inline-block",
        background: s.bg,
        color: s.color,
        borderRadius: T.radius.pill,
        padding: "2px 8px",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {t(`agent.${type}`)}
    </span>
  );
}
