"use client";

import { useState, useTransition } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

type Lang = "en" | "zh";

const LABELS: Record<Lang, string> = {
  en: "EN",
  zh: "繁中",
};

export default function LanguageToggle({
  clientId,
  initial,
}: {
  clientId: string;
  initial: Lang;
}) {
  const { t } = useI18n();
  const [lang, setLang] = useState<Lang>(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(next: Lang) {
    if (next === lang || isPending) return;
    const prev = lang;
    setLang(next);
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/client/${clientId}/language`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: next }),
        });
        if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      } catch (e) {
        setLang(prev);
        setError((e as Error).message);
      }
    });
  }

  return (
    <div data-testid="language-toggle" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted, width: "100%", textAlign: "center" }}>
        {t("lang.llmOutput")}
      </div>
      <div style={{
        display: "inline-flex", gap: 0, padding: 2, borderRadius: 99,
        border: `1px solid ${T.border}`, background: "rgba(0,0,0,0.25)",
      }}>
        {(["en", "zh"] as const).map((opt) => {
          const active = lang === opt;
          return (
            <button
              key={opt}
              type="button"
              data-testid={`language-${opt}`}
              onClick={() => pick(opt)}
              disabled={isPending}
              aria-pressed={active}
              style={{
                fontSize: 11, padding: "4px 12px", borderRadius: 99,
                border: "none",
                background: active ? "rgba(196,148,82,0.22)" : "transparent",
                color: active ? "#e4c08c" : T.muted,
                cursor: isPending ? "wait" : "pointer",
                fontWeight: active ? 700 : 500,
                letterSpacing: "0.04em",
              }}
            >
              {LABELS[opt]}
            </button>
          );
        })}
      </div>
      {error && (
        <div style={{ fontSize: 10, color: "#f87171" }}>{error}</div>
      )}
    </div>
  );
}
