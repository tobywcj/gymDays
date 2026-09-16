"use client";

// Global AI model switch (dashboard chrome). One selection here drives every
// AI feature — there is no per-feature model picker. The choice is persisted to
// a cookie by LlmModelProvider so server routes resolve it without the client
// re-sending it on each call.
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useLlmModel } from "@/lib/llm-context";
import { modelEnabled, modelShortLabel } from "@/lib/llm-model";

function ChipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}

export default function ModelSelect() {
  const { t } = useI18n();
  const { catalog, model, setModel } = useLlmModel();

  if (!catalog) {
    // AI service unreachable — show a muted, inert chip rather than an empty picker.
    return (
      <div
        data-testid="model-select-offline"
        title={t("panel.serviceDown")}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, color: T.muted, fontSize: 11, fontWeight: 600 }}
      >
        <ChipIcon />
        {t("model.offline")}
      </div>
    );
  }

  return (
    <div data-testid="model-select" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span
        aria-hidden
        style={{ display: "inline-flex", alignItems: "center", gap: 5, color: T.mutedMid }}
      >
        <ChipIcon />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>{t("model.label")}</span>
      </span>
      <select
        value={model}
        aria-label={t("model.label")}
        title={t("model.label")}
        onChange={(e) => setModel(e.target.value)}
        style={{
          background: "rgba(0, 0, 0, 0.25)",
          border: `1px solid ${T.border}`,
          borderRadius: 99,
          padding: "6px 12px",
          color: T.text,
          fontFamily: T.font.sans,
          fontSize: 12,
          fontWeight: 600,
          outline: "none",
          cursor: "pointer",
          maxWidth: 220,
          boxShadow: "0 1px 0 rgba(255,252,245,0.06) inset",
        }}
      >
        {Object.entries(catalog.models).map(([id, label]) => {
          const enabled = modelEnabled(id, catalog.keys);
          return (
            <option key={id} value={id} disabled={!enabled}>
              {modelShortLabel(label)}{enabled ? "" : t("panel.noKey")}
            </option>
          );
        })}
      </select>
    </div>
  );
}
