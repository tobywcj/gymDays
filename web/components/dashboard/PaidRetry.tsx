"use client";

// One-click paid fallback. When a run fails because the free Gemma tier is
// rate-limited (stream errorCode === "quota_exhausted"), this offers to re-run
// that same run on the trainer's paid API — nothing paid runs until they click.
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useLlmModel } from "@/lib/llm-context";
import { firstPaidModel, modelShortLabel } from "@/lib/llm-model";
import type { AgentStream } from "@/lib/useAgentStream";

export default function PaidRetry({ stream }: { stream: AgentStream }) {
  const { t } = useI18n();
  const { catalog } = useLlmModel();

  if (stream.errorCode !== "quota_exhausted" || stream.running) return null;

  const paid = firstPaidModel(catalog);
  const label = paid ? modelShortLabel(catalog!.models[paid]) : "";

  return (
    <div
      data-testid="paid-retry"
      style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        background: "rgba(196,148,82,0.10)",
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      <span style={{ fontSize: 11.5, color: T.mutedMid, flex: "1 1 200px", lineHeight: 1.45 }}>
        {t("paid.freeBusy")}
      </span>
      {paid ? (
        <button
          onClick={() => stream.retry({ llm_model: paid })}
          data-testid="paid-retry-btn"
          title={t("paid.usesKey")}
          style={{
            fontSize: 12, fontWeight: 600, padding: "7px 14px", borderRadius: 99,
            background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
            border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {t("paid.useApi")} · {label}
        </button>
      ) : (
        <span style={{ fontSize: 11, color: T.accent, flexShrink: 0 }}>{t("paid.addKey")}</span>
      )}
    </div>
  );
}
