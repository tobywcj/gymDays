"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import LiveSources from "./LiveSources";
import MarkdownSummary from "./MarkdownSummary";
import WindowSlider from "./WindowSlider";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import PaidRetry from "./PaidRetry";

type AdvicePlan = { type: "advice"; advice: string; generated_at: string };

type Props = {
  clientId: string;
  mealPlan: { week_start: string; plan: AdvicePlan | Record<string, unknown> } | null;
  llms: { default: string; models: Record<string, string>; keys: { openai: boolean; anthropic: boolean } } | null;
};

export default function MealPlanPanel({ clientId, mealPlan, llms }: Props) {
  const router = useRouter();
  const stream = useAgentStream();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const busy = stream.running;
  const latestThought = stream.thoughts[stream.thoughts.length - 1];

  const advice = (mealPlan?.plan as AdvicePlan | undefined)?.advice ?? null;

  async function generate() {
    setError(null);
    try {
      await stream.start(`/api/ai/nutrition/${clientId}/stream`, { window_days: windowDays });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 180px" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t("nutrition.title")}</div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
            {mealPlan
              ? <>{t("panel.weekOf")} <strong style={{ color: T.mutedMid }}>{mealPlan.week_start}</strong></>
              : t("nutrition.empty")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
          <WindowSlider value={windowDays} onChange={setWindowDays} disabled={busy} />
          <button
            onClick={generate}
            disabled={busy || !llms}
            data-testid="run-nutrition"
            style={{
              fontSize: 12,
              padding: "7px 14px",
              borderRadius: 99,
              background: "linear-gradient(135deg, rgba(98,132,88,0.95) 0%, rgba(58,82,52,0.95) 100%)",
              border: "1px solid rgba(255,252,245,0.25)",
              color: "#fffdf6",
              fontWeight: 600,
              cursor: busy || !llms ? "not-allowed" : "pointer",
              opacity: busy || !llms ? 0.7 : 1,
              boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(58,82,52,0.45)",
            }}
          >
            {busy ? <Spinner emoji="🥗" label={plainThought(latestThought) ?? t("common.analysing")} /> : advice ? t("nutrition.refresh") : t("nutrition.get")}
          </button>
        </div>
      </div>

      {busy && <LiveSources sources={stream.sources} />}

      {busy && stream.thoughts.length > 0 && (
        <div
          data-testid="nutrition-thoughts"
          style={{
            display: "flex", flexDirection: "column", gap: 4,
            padding: "8px 12px", background: "rgba(0,0,0,0.18)",
            borderRadius: 8, borderLeft: `2px solid ${T.border}`,
            maxHeight: 140, overflowY: "auto",
          }}
        >
          {stream.thoughts.map((line, i) => (
            <div key={i} style={{
              fontSize: 11, color: T.muted, lineHeight: 1.45,
              fontFamily: T.font.mono,
              opacity: i === stream.thoughts.length - 1 ? 1 : 0.55,
            }}>
              <ThoughtLine line={line} />
            </div>
          ))}
        </div>
      )}

      {!llms && (
        <div data-testid="nutrition-service-down" style={{ fontSize: 12, color: T.muted }}>
          {t("panel.serviceDown")}{" "}
          <code style={{ fontFamily: T.font.mono, color: T.accent }}>uvicorn ai.main:app --port 8001</code>.
        </div>
      )}

      <PaidRetry stream={stream} />

      {error && (
        <div data-testid="nutrition-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>
          {error}
        </div>
      )}

      {!busy && advice && <MarkdownSummary text={advice} />}
    </div>
  );
}
