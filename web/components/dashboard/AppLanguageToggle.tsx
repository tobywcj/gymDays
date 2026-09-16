"use client";

// Global app-UI language switch (trainer dashboard chrome).
// Distinct from LanguageToggle.tsx, which sets a single client's LLM output language.
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { LOCALE_LABELS, type Locale } from "@/lib/i18n";
import { GlobeIcon } from "./icons";

export default function AppLanguageToggle() {
  const { locale, setLocale, t } = useI18n();

  return (
    <div
      data-testid="app-language-toggle"
      style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
    >
      <span
        aria-hidden
        style={{ display: "inline-flex", alignItems: "center", gap: 5, color: T.mutedMid }}
      >
        <GlobeIcon />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>
          {t("lang.appLabel")}
        </span>
      </span>
      <div
        role="group"
        aria-label={t("lang.appLabel")}
        title={t("lang.appLabel")}
        style={{
          display: "inline-flex",
          gap: 0,
          padding: 2,
          borderRadius: 99,
          border: `1px solid ${T.border}`,
          background: "rgba(0,0,0,0.25)",
        }}
      >
      {(["en", "zh"] as const).map((opt: Locale) => {
        const active = locale === opt;
        return (
          <button
            key={opt}
            type="button"
            data-testid={`app-language-${opt}`}
            onClick={() => setLocale(opt)}
            aria-pressed={active}
            style={{
              fontSize: 11,
              padding: "4px 12px",
              borderRadius: 99,
              border: "none",
              background: active ? "rgba(196,148,82,0.22)" : "transparent",
              color: active ? "#e4c08c" : T.muted,
              cursor: "pointer",
              fontWeight: active ? 700 : 500,
              letterSpacing: "0.04em",
            }}
          >
            {LOCALE_LABELS[opt]}
          </button>
        );
      })}
      </div>
    </div>
  );
}
