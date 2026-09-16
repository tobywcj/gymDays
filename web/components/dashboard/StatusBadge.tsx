"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import type { ClientStatus } from "@/lib/mock";

const map: Record<ClientStatus, { bg: string; color: string; dot: string }> = {
  Active:  { bg: "rgba(34,197,94,0.15)", color: "#4ade80", dot: "#22c55e" },
  Resting: { bg: "rgba(234,179,8,0.15)",  color: "#fbbf24", dot: "#eab308" },
  Flagged: { bg: "rgba(239,68,68,0.15)",  color: "#f87171", dot: "#ef4444" },
};

export default function StatusBadge({ status }: { status: ClientStatus }) {
  const { t } = useI18n();
  const s = map[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: s.bg,
        color: s.color,
        borderRadius: T.radius.pill,
        padding: "3px 9px",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.dot, boxShadow: `0 0 5px ${s.dot}` }} />
      {t(`status.${status}`)}
    </span>
  );
}
