"use client";

import React, { useState } from "react";
import { T } from "@/lib/design-tokens";
import AgentMessage, { type ChatTurn, type AgentName } from "./AgentMessage";
import Spinner from "./Spinner";
import ThoughtLine from "./ThoughtLine";

const AGENTS: AgentName[] = ["progress", "planner", "nutrition", "messaging"];

const NODE: Record<AgentName, { label: string; color: string; bg: string }> = {
  progress:  { label: "Progress",  color: "#e4c08c", bg: "rgba(196,148,82,0.18)"  },
  planner:   { label: "Planner",   color: "#e89878", bg: "rgba(196,108,76,0.18)"  },
  nutrition: { label: "Nutrition", color: "#b0d4a0", bg: "rgba(98,132,88,0.18)"   },
  messaging: { label: "Messaging", color: "#bcd3b8", bg: "rgba(140,164,140,0.18)" },
};

function latestFor(turns: ChatTurn[], agent: AgentName): ChatTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].agent === agent) return turns[i];
  }
}

function buildMessageBody(turn: ChatTurn): string {
  if (turn.agent === "progress" && turn.progressReport?.summary) {
    return `📊 *Progress Update*\n\n${turn.progressReport.summary}`;
  }
  if (turn.agent === "planner" && turn.program) {
    const days = turn.program.plan.days ?? [];
    const lines = days.map((d: { day: string; focus: string }) => `• *${d.day}*: ${d.focus}`).join("\n");
    return `📋 *Your Training Plan*\n\n${lines || "Plan ready — check the app for details."}`;
  }
  if (turn.agent === "nutrition" && turn.mealPlan) {
    const advice = (turn.mealPlan.plan as { advice?: string }).advice;
    return advice ? `🥗 *Nutrition Advice*\n\n${advice}` : "";
  }
  if (turn.agent === "messaging" && turn.messageDraft) {
    return turn.messageDraft;
  }
  return "";
}

function microLine(turn: ChatTurn): string {
  if (turn.agent === "progress" && turn.progressReport?.summary) {
    const s = turn.progressReport.summary;
    const dot = s.indexOf(".");
    return dot > 0 ? s.slice(0, dot + 1) : s.slice(0, 72);
  }
  if (turn.agent === "planner" && turn.program) {
    const n = turn.program.plan.days?.length ?? 0;
    return `${n} training day${n !== 1 ? "s" : ""} planned`;
  }
  if (turn.agent === "nutrition" && turn.mealPlan) {
    const advice = (turn.mealPlan.plan as { advice?: string }).advice;
    if (advice) {
      const first = advice.replace(/^#+\s*/m, "").split("\n").find((l) => l.trim());
      return first ? first.replace(/\*\*/g, "").slice(0, 72) : "Advice ready";
    }
    const t = (turn.mealPlan.plan as { daily_targets?: { kcal: number; protein_g: number; carbs_g: number } }).daily_targets;
    if (t) return `${t.kcal} kcal · P ${t.protein_g}g · C ${t.carbs_g}g`;
  }
  if (turn.agent === "messaging") {
    return turn.messageDraft ? "Message drafted" : "Check-in sent";
  }
  return "";
}

type Props = {
  turns: ChatTurn[];
  isRunning: boolean;
  clientId: string;
  onRun: (agent: AgentName) => void;
  onSendFoodGuide: () => void;
  onDismissFlags: () => void;
};

export default function AgentPipeline({
  turns, isRunning, clientId, onRun, onSendFoodGuide, onDismissFlags,
}: Props) {
  const [selected, setSelected] = useState<AgentName | null>(null);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendStatus, setSendStatus] = useState<"idle" | "sent" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);

  async function sendToClient(turn: ChatTurn) {
    const body = buildMessageBody(turn);
    if (!body) return;
    setSendBusy(true);
    setSendStatus("idle");
    setSendError(null);
    try {
      const r = await fetch(`/api/messaging/send/${clientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setSendStatus("sent");
      setTimeout(() => setSendStatus("idle"), 3000);
    } catch (e) {
      setSendStatus("error");
      setSendError((e as Error).message);
    } finally {
      setSendBusy(false);
    }
  }

  const latest = Object.fromEntries(
    AGENTS.map((a) => [a, latestFor(turns, a)])
  ) as Record<AgentName, ChatTurn | undefined>;

  function handleNode(agent: AgentName) {
    const t = latest[agent];
    if (t?.status === "running") return;
    if (t?.status === "done" || t?.status === "error") {
      const next = selected === agent ? null : agent;
      setSelected(next);
      setSendStatus("idle");
      setSendError(null);
      return;
    }
    if (!isRunning) {
      onRun(agent);
      setSelected(agent);
    }
  }

  const selectedTurn = selected ? latest[selected] : null;

  return (
    <>
      <style>{`
        @keyframes nodePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(0.72); }
        }
      `}</style>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

        {/* ── Node-edge row ─────────────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {AGENTS.map((agent, i) => {
            const prevAgent = AGENTS[i - 1];
            const edgeActive = i > 0 && latest[prevAgent]?.status === "done";

            return (
              <React.Fragment key={agent}>
                {i > 0 && (
                  <div style={{
                    flex: "0 0 28px", alignSelf: "center", height: 2,
                    position: "relative",
                    background: edgeActive
                      ? `linear-gradient(90deg, ${NODE[prevAgent].color}70, ${NODE[agent].color}60)`
                      : T.border,
                    transition: "background 0.5s ease",
                  }}>
                    {/* arrowhead */}
                    <div style={{
                      position: "absolute", right: -4, top: "50%",
                      transform: "translateY(-50%)",
                      width: 0, height: 0,
                      borderTop: "4px solid transparent",
                      borderBottom: "4px solid transparent",
                      borderLeft: `6px solid ${edgeActive ? NODE[agent].color + "60" : T.border}`,
                      transition: "border-left-color 0.5s ease",
                    }} />
                  </div>
                )}

                <NodeCard
                  agent={agent}
                  turn={latest[agent]}
                  isSelected={selected === agent}
                  isGloballyRunning={isRunning}
                  onClick={() => handleNode(agent)}
                />
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Empty-state hint ──────────────────────────────────────── */}
        {turns.length === 0 && !isRunning && (
          <p style={{ margin: 0, fontSize: 12, color: T.muted }}>
            Click{" "}
            <span style={{ color: NODE.progress.color, fontWeight: 600 }}>Progress</span>
            {" "}to start the weekly review.
          </p>
        )}

        {/* ── Detail panel ──────────────────────────────────────────── */}
        {selectedTurn && (
          <div style={{
            padding: "16px 20px",
            background: "rgba(255,252,245,0.03)",
            borderRadius: T.radius.card,
            border: `1px solid ${T.border}`,
            borderTop: `2px solid ${NODE[selected!].color}45`,
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            {/* Send to client bar */}
            {selectedTurn.status === "done" && buildMessageBody(selectedTurn) && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                {sendStatus === "sent" && (
                  <span style={{ fontSize: 11, color: "#4ade80" }}>✓ Sent</span>
                )}
                {sendStatus === "error" && (
                  <span style={{ fontSize: 11, color: "#f87171" }} title={sendError ?? undefined}>✗ Failed</span>
                )}
                <button
                  onClick={() => sendToClient(selectedTurn)}
                  disabled={sendBusy}
                  style={{
                    fontSize: 11,
                    padding: "5px 12px",
                    borderRadius: 99,
                    background: sendBusy ? "rgba(0,0,0,0.3)" : `rgba(255,252,245,0.08)`,
                    border: `1px solid ${NODE[selected!].color}55`,
                    color: NODE[selected!].color,
                    fontWeight: 600,
                    cursor: sendBusy ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    transition: "background 0.15s",
                  }}
                >
                  {sendBusy
                    ? <Spinner emoji="📨" label="Sending…" />
                    : "📨 Send to client"}
                </button>
              </div>
            )}

            <AgentMessage
              turn={selectedTurn}
              clientId={clientId}
              onRunPlanner={() => { onRun("planner"); setSelected("planner"); }}
              onRunNutrition={() => { onRun("nutrition"); setSelected("nutrition"); }}
              onSendCheckin={() => { onRun("messaging"); setSelected("messaging"); }}
              onSendFoodGuide={onSendFoodGuide}
              onDismissFlags={onDismissFlags}
            />
          </div>
        )}
      </div>
    </>
  );
}

function NodeCard({
  agent, turn, isSelected, isGloballyRunning, onClick,
}: {
  agent: AgentName;
  turn: ChatTurn | undefined;
  isSelected: boolean;
  isGloballyRunning: boolean;
  onClick: () => void;
}) {
  const n = NODE[agent];
  const status = turn?.status;
  const isDone    = status === "done";
  const isRunning = status === "running";
  const isError   = status === "error";

  const dotColor = isError   ? "#f87171"
    : isDone || isRunning    ? n.color
    : "rgba(244,237,226,0.18)";

  const isClickable = isDone || isError || (!isGloballyRunning && !isRunning);

  return (
    <button
      onClick={onClick}
      disabled={!isClickable}
      style={{
        flex: 1, minWidth: 76,
        display: "flex", flexDirection: "column", gap: 5,
        padding: "10px 12px",
        borderRadius: T.radius.md,
        background: isSelected ? n.bg : "rgba(255,252,245,0.02)",
        border: `1px solid ${isSelected ? n.color + "55" : T.border}`,
        cursor: isClickable ? "pointer" : "default",
        textAlign: "left",
        transition: "background 0.18s, border-color 0.18s",
        opacity: isGloballyRunning && !isRunning && !isDone && !isError ? 0.45 : 1,
      }}
      onMouseEnter={(e) => { if (isClickable) e.currentTarget.style.background = n.bg; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,252,245,0.02)"; }}
    >
      {/* dot + label */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%",
          flexShrink: 0, background: dotColor,
          animation: isRunning ? "nodePulse 1.2s ease-in-out infinite" : "none",
          boxShadow: isDone ? `0 0 5px ${n.color}55` : "none",
          transition: "background 0.3s, box-shadow 0.3s",
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: isDone ? n.color : "rgba(244,237,226,0.42)",
          transition: "color 0.3s",
        }}>
          {n.label}
        </span>
      </div>

      {/* state line — latest streamed thought, falls back to a spinner */}
      {isRunning && (
        <span style={{
          fontSize: 10, color: "rgba(244,237,226,0.55)", lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          minHeight: 12,
        }}>
          {turn?.thoughts?.length
            ? <ThoughtLine line={turn.thoughts[turn.thoughts.length - 1]} />
            : <Spinner emoji={n.label === "Progress" ? "📊" : n.label === "Planner" ? "📋" : n.label === "Nutrition" ? "🥗" : "📨"} />}
        </span>
      )}
      {isDone && (
        <span style={{
          fontSize: 10, color: "rgba(244,237,226,0.5)", lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}>
          {microLine(turn!)}
        </span>
      )}
      {isError && (
        <span style={{ fontSize: 10, color: "#f87171" }}>
          failed — click to review
        </span>
      )}
      {!turn && !isGloballyRunning && (
        <span style={{ fontSize: 10, color: "rgba(244,237,226,0.2)" }}>
          idle
        </span>
      )}
    </button>
  );
}
