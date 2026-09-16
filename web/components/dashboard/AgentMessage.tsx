"use client";

import { useState } from "react";
import Link from "next/link";
import { T } from "@/lib/design-tokens";
import PulseStrip from "./PulseStrip";
import FlagChips, { type Flag } from "./FlagChips";
import NutritionDayCard, { type NutritionDay } from "./NutritionDayCard";
import MarkdownSummary from "./MarkdownSummary";
import Spinner from "./Spinner";
import ThoughtLine, { plainThought } from "./ThoughtLine";
import LiveSources from "./LiveSources";
import type { StreamSource } from "@/lib/useAgentStream";

export type AgentName = "progress" | "planner" | "nutrition" | "messaging";

export type ProgressReport = {
  id: string;
  period_start: string;
  period_end: string;
  summary: string | null;
  flags: Flag[] | null;
  created_at: string;
};

export type Program = {
  week_start: string;
  plan: {
    days: Array<{
      day: string;
      focus: string;
      exercises: Array<{ exercise_id: string; sets: number | string; reps: number | string; notes?: string }>;
    }>;
  };
};

export type MealPlan = {
  week_start: string;
  plan: {
    type?: "advice";
    advice?: string;
    generated_at?: string;
    // legacy structured format
    daily_targets?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
    days?: NutritionDay[];
  };
};


type ChatAction = {
  label: string;
  onClick: () => void;
  variant: "primary" | "ghost";
};

export type ChatTurn = {
  id: string;
  agent: AgentName;
  status: "running" | "done" | "error";
  progressReport?: ProgressReport;
  program?: Program;
  mealPlan?: MealPlan;
  messageDraft?: string;
  errorMsg?: string;
  // Pulse strip inputs (computed from activities, passed in)
  sessionsThisWeek?: number;
  loadPct?: number;
  // Concise step-by-step "thoughts" streamed from the agent run.
  thoughts?: string[];
  // Data sources (web results) surfaced live during the run.
  sources?: StreamSource[];
  timestamp: number;
};

const BADGE: Record<AgentName, { label: string; bg: string; color: string }> = {
  progress:  { label: "Progress",   bg: "rgba(196,148,82,0.20)",  color: "#e4c08c" },
  planner:   { label: "Planner",    bg: "rgba(196,108,76,0.20)",  color: "#e89878" },
  nutrition: { label: "Nutrition",  bg: "rgba(98,132,88,0.22)",   color: "#b0d4a0" },
  messaging: { label: "Messaging",  bg: "rgba(140,164,140,0.22)", color: "#bcd3b8" },
};

function Badge({ agent }: { agent: AgentName }) {
  const s = BADGE[agent];
  return (
    <span style={{
      display: "inline-block",
      background: s.bg, color: s.color,
      borderRadius: T.radius.pill, padding: "2px 8px",
      fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
      flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

function ActionChips({ actions }: { actions: ChatAction[] }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={a.onClick}
          style={{
            fontSize: 11, fontWeight: 600,
            padding: "5px 12px", borderRadius: T.radius.pill,
            border: `1px solid ${a.variant === "primary" ? "rgba(196,148,82,0.5)" : T.border}`,
            background: a.variant === "primary" ? "rgba(196,148,82,0.18)" : "rgba(0,0,0,0.18)",
            color: a.variant === "primary" ? "#e4c08c" : T.mutedMid,
            cursor: "pointer",
            transition: "opacity 0.1s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = "0.75")}
          onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function RunningIndicator({ agent, latest }: { agent: AgentName; latest?: string }) {
  const config: Record<AgentName, { emoji: string; label: string }> = {
    progress:  { emoji: "📊", label: "Analysing training data…" },
    planner:   { emoji: "📋", label: "Generating workout plan…" },
    nutrition: { emoji: "🥗", label: "Building food guidance…"  },
    messaging: { emoji: "📨", label: "Drafting check-in…"       },
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.muted }}>
      <Spinner emoji={config[agent].emoji} label={plainThought(latest) ?? config[agent].label} />
    </div>
  );
}

function ThoughtList({ thoughts }: { thoughts: string[] }) {
  if (thoughts.length === 0) return null;
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 4,
      padding: "8px 12px",
      background: "rgba(0,0,0,0.18)",
      borderRadius: 8,
      borderLeft: `2px solid ${T.border}`,
      maxHeight: 140, overflowY: "auto",
    }}>
      {thoughts.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: 11, color: T.muted, lineHeight: 1.45,
            fontFamily: T.font.mono,
            opacity: i === thoughts.length - 1 ? 1 : 0.55,
          }}
        >
          <ThoughtLine line={line} />
        </div>
      ))}
    </div>
  );
}

type Props = {
  turn: ChatTurn;
  clientId: string;
  onRunPlanner: () => void;
  onRunNutrition: () => void;
  onSendCheckin: () => void;
  onSendFoodGuide: () => void;
  onDismissFlags: () => void;
};

export default function AgentMessage({
  turn, clientId,
  onRunPlanner, onRunNutrition, onSendCheckin, onSendFoodGuide, onDismissFlags,
}: Props) {
  const [programOpen, setProgramOpen] = useState(false);

  const actions: ChatAction[] = [];

  if (turn.status === "done") {
    if (turn.agent === "progress") {
      actions.push({ label: "Run Planner", onClick: onRunPlanner, variant: "primary" });
      actions.push({ label: "Send check-in now", onClick: onSendCheckin, variant: "ghost" });
      if ((turn.progressReport?.flags?.length ?? 0) > 0) {
        actions.push({ label: "Dismiss flags", onClick: onDismissFlags, variant: "ghost" });
      }
    }
    if (turn.agent === "planner") {
      actions.push({ label: "Run Nutrition", onClick: onRunNutrition, variant: "primary" });
      actions.push({ label: "View full plan", onClick: () => {}, variant: "ghost" });
    }
    if (turn.agent === "nutrition") {
      actions.push({ label: "Send food guide to client", onClick: onSendFoodGuide, variant: "primary" });
    }
    if (turn.agent === "messaging") {
      // Messaging turn is informational — message already sent via flow
    }
  }

  // Pulse strip computation for progress turns
  const sessionsStr = turn.sessionsThisWeek != null ? String(turn.sessionsThisWeek) : "—";
  const loadStr = turn.loadPct != null
    ? (turn.loadPct >= 0 ? `↑ +${turn.loadPct}%` : `↓ ${turn.loadPct}%`)
    : "—";
  const loadUp = turn.loadPct != null ? turn.loadPct >= 0 : undefined;
  const flagCount = turn.progressReport?.flags?.length ?? 0;

  // Program week summary (collapsed)
  const programDays = turn.program?.plan?.days ?? [];
  const weekSummary = programDays.map((d) => `${d.day}: ${d.focus}`).join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 620 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge agent={turn.agent} />
        {turn.status === "running" && (
          <RunningIndicator
            agent={turn.agent}
            latest={turn.thoughts?.[turn.thoughts.length - 1]}
          />
        )}
        {turn.status === "error" && (
          <span style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>
            {turn.errorMsg ?? "Agent failed"}
          </span>
        )}
      </div>

      {/* Live data sources — surfaced in real time as the agent searches the web */}
      {turn.sources && turn.sources.length > 0 && (
        <LiveSources sources={turn.sources} />
      )}

      {/* Thought trail — shown while running and kept around once done */}
      {turn.thoughts && turn.thoughts.length > 0 && (
        <ThoughtList thoughts={turn.thoughts} />
      )}

      {/* Content */}
      {turn.status === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

          {/* Progress agent */}
          {turn.agent === "progress" && turn.progressReport && (
            <>
              <PulseStrip
                sessions={sessionsStr}
                load={loadStr}
                loadUp={loadUp}
                flagCount={flagCount}
              />
              {turn.progressReport.summary && (
                <div style={{
                  background: "rgba(0,0,0,0.12)", padding: "10px 14px", borderRadius: 8,
                }}>
                  <MarkdownSummary text={turn.progressReport.summary} />
                </div>
              )}
              {flagCount > 0 && (
                <FlagChips flags={turn.progressReport.flags!} />
              )}
              <div style={{ fontSize: 10, color: T.muted }}>
                {turn.progressReport.period_start} → {turn.progressReport.period_end}
              </div>
            </>
          )}

          {/* Planner agent */}
          {turn.agent === "planner" && turn.program && (
            <>
              {weekSummary && (
                <div style={{ fontSize: 12, color: T.mutedMid, lineHeight: 1.5 }}>
                  {weekSummary}
                </div>
              )}
              <button
                type="button"
                onClick={() => setProgramOpen(!programOpen)}
                style={{
                  alignSelf: "flex-start", fontSize: 11,
                  color: T.accent, background: "none", border: "none",
                  cursor: "pointer", padding: 0, fontWeight: 600,
                }}
              >
                {programOpen ? "Collapse ▴" : "Expand program ▾"}
              </button>
              {programOpen && programDays.map((day, i) => (
                <div
                  key={i}
                  style={{
                    background: "rgba(0,0,0,0.18)", borderRadius: 10,
                    padding: "10px 14px", borderLeft: `3px solid ${T.accent}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                      {day.day}
                    </span>
                    <span style={{ fontSize: 11, color: T.mutedMid }}>{day.focus}</span>
                  </div>
                  {day.exercises.map((ex, j) => (
                    <div key={j} style={{
                      display: "flex", gap: 12, fontSize: 11, color: T.mutedMid, padding: "2px 0",
                    }}>
                      <span style={{ flex: 1, color: T.text }}>{ex.exercise_id.slice(0, 8)}…</span>
                      <span>{ex.sets}×{ex.reps}</span>
                      {ex.notes && <span style={{ color: T.muted }}>{ex.notes}</span>}
                    </div>
                  ))}
                </div>
              ))}
              <Link
                href={`/clients/${clientId}/program`}
                style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}
              >
                View full plan →
              </Link>
            </>
          )}

          {/* Nutrition agent */}
          {turn.agent === "nutrition" && turn.mealPlan && (
            <>
              {turn.mealPlan.plan?.advice
                ? <MarkdownSummary text={turn.mealPlan.plan.advice} />
                : (turn.mealPlan.plan?.days ?? []).length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(turn.mealPlan.plan.days ?? []).map((day, i) => (
                      <NutritionDayCard key={i} day={day} />
                    ))}
                  </div>
                )
              }
            </>
          )}

          {/* Messaging agent */}
          {turn.agent === "messaging" && turn.messageDraft && (
            <div style={{
              fontSize: 12, color: T.mutedMid, lineHeight: 1.6,
              background: "rgba(140,164,140,0.08)",
              border: `1px solid rgba(140,164,140,0.2)`,
              padding: "10px 14px", borderRadius: 8,
              fontStyle: "italic",
            }}>
              "{turn.messageDraft}"
            </div>
          )}
          {turn.agent === "messaging" && !turn.messageDraft && (
            <div style={{ fontSize: 12, color: T.muted }}>Check-in sent.</div>
          )}

        </div>
      )}

      {/* Action chips */}
      {actions.length > 0 && <ActionChips actions={actions} />}
    </div>
  );
}
