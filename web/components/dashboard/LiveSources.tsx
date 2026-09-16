"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import type { StreamSource } from "@/lib/useAgentStream";

// Renders the data sources an agent surfaces *live* while it searches the web
// (see ai/crew/tools/search.py → thoughts.publish_source). Shown under the
// loading spinner so the trainer/client can see, in real time, exactly which
// references the answer is being built from. Renders nothing until the first
// source arrives.
export default function LiveSources({ sources }: { sources: StreamSource[] }) {
  const { t } = useI18n();
  if (!sources.length) return null;
  return (
    <div
      data-testid="live-sources"
      style={{
        display: "flex", flexDirection: "column", gap: 3,
        padding: "8px 12px", background: "rgba(0,0,0,0.18)",
        borderRadius: 8, borderLeft: `2px solid ${T.accent}`,
        maxHeight: 140, overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.accent, display: "flex", gap: 5, alignItems: "center" }}>
        🌐 {t("program.sources")}
      </div>
      {sources.map((s, i) => (
        <a
          key={s.url + i}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: T.accent, lineHeight: 1.4, textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          title={s.url}
        >
          · {s.title || s.url}
        </a>
      ))}
    </div>
  );
}
