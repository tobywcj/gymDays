"use client";

import { useState, useTransition } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

// Per-agent data-source control that lives inside the client header card.
// Every AI agent that can run on this client shows the FULL list of knowledge
// sources as a checklist. The sources the agent uses out of the box are ticked
// by default; the trainer can untick those or tick extra ones. Each change
// persists to clients.agent_source_prefs (only diffs from the default are
// stored), and the AI service resolves the agent's tool set from it
// (ai/crew/agents.py gate_tools) — so a ticked source is a tool the agent can
// read, and an unticked one is withheld when it generates output.
//
// Every source id maps to a real gateable/buildable tool — keep this list, the
// API allowlist (api/client/[id]/agent-sources) and SOURCE_TOOLS in sync.

type SourceId =
  | "profile" | "screening" | "inbody" | "workouts" | "program"
  | "progress" | "memory" | "knowledge" | "food" | "exercises" | "web";

// Display order — shared by every agent so the checklist reads consistently.
const ALL_SOURCES: SourceId[] = [
  "profile", "screening", "inbody", "workouts", "program",
  "progress", "memory", "knowledge", "food", "exercises", "web",
];

const SOURCE_ICON: Record<SourceId, string> = {
  profile: "🪪", screening: "🩺", inbody: "⚖️", workouts: "🏋️", program: "🗓️",
  progress: "📈", memory: "🧠", knowledge: "📚", food: "🥦", exercises: "📋", web: "🌐",
};

// Each agent → the sources it uses out of the box (ticked by default). These
// mirror the exact tool set each agent factory builds in ai/crew/agents.py and
// are asserted against it in the parity test — keep them in sync.
const AGENT_DEFAULTS: Record<string, SourceId[]> = {
  planner:   ["profile", "screening", "inbody", "workouts", "progress", "memory", "knowledge", "exercises", "web"],
  progress:  ["profile", "inbody", "workouts", "memory", "knowledge", "web"],
  nutrition: ["profile", "inbody", "workouts", "program", "progress", "memory", "food", "knowledge", "web"],
  concierge: ["profile", "inbody", "workouts", "program", "progress", "memory", "knowledge", "web"],
  messaging: ["profile", "workouts", "program", "progress", "memory", "knowledge", "web"],
  exercise:  ["profile", "screening", "memory", "exercises", "web"],
};
const AGENT_IDS = Object.keys(AGENT_DEFAULTS);

type Prefs = Record<string, Partial<Record<SourceId, boolean>>>;

export default function AgentKnowledgeMap({
  clientId,
  initialPrefs,
}: {
  clientId: string;
  initialPrefs?: Prefs;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs ?? {});
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const isDefault = (agent: string, source: SourceId) => AGENT_DEFAULTS[agent].includes(source);
  // A source is ON if overridden, else it falls back to the agent's default.
  const isOn = (agent: string, source: SourceId) => prefs[agent]?.[source] ?? isDefault(agent, source);

  // Count of sources the trainer changed away from the default (added or removed).
  const customCount = AGENT_IDS.reduce(
    (n, a) => n + Object.keys(prefs[a] ?? {}).length,
    0,
  );

  function toggle(agent: string, source: SourceId) {
    const nextOn = !isOn(agent, source);
    const prev = prefs;
    const next: Prefs = { ...prefs, [agent]: { ...(prefs[agent] ?? {}) } };
    if (nextOn === isDefault(agent, source)) delete next[agent][source]; // back to default → drop override
    else next[agent][source] = nextOn;
    if (Object.keys(next[agent]).length === 0) delete next[agent];

    persist(next, prev);
  }

  // Clear every override → all features snap back to their original defaults.
  function resetAll() {
    if (customCount === 0) return;
    persist({}, prefs);
  }

  function persist(next: Prefs, prev: Prefs) {
    setPrefs(next);
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch(`/api/client/${clientId}/agent-sources`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefs: next }),
        });
        if (!r.ok) throw new Error(`${r.status}`);
      } catch {
        setPrefs(prev); // revert the optimistic change
        setError(t("agentmap.saveError"));
      }
    });
  }

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-testid="agent-knowledge-toggle"
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "transparent", border: "none", padding: 0, cursor: "pointer",
          color: T.text, textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: 10, color: T.muted, display: "inline-block",
            transform: open ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 140ms ease",
          }}
        >
          ▶
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {t("agentmap.title")}
          </span>
          <span style={{ fontSize: 11, color: T.muted, fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>
            {t("agentmap.subtitle")}
          </span>
        </span>
        {customCount > 0 && (
          <span
            style={{
              marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
              textTransform: "uppercase", color: "#e4c08c",
              background: "rgba(196,148,82,0.18)", borderRadius: T.radius.pill, padding: "2px 8px",
            }}
          >
            {customCount} {t("agentmap.customLabel")}
          </span>
        )}
      </button>

      {open && (
        <>
          {error && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#f87171" }}>{error}</div>
          )}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 10, color: T.muted }}>
              {customCount > 0
                ? `${customCount} ${t("agentmap.customLabel")}`
                : t("agentmap.allDefault")}
            </span>
            <button
              type="button"
              onClick={resetAll}
              disabled={customCount === 0}
              data-testid="agent-knowledge-reset"
              style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                padding: "4px 10px", borderRadius: T.radius.pill,
                border: `1px solid ${T.border}`,
                background: "transparent",
                color: customCount === 0 ? T.muted : "#e4c08c",
                cursor: customCount === 0 ? "default" : "pointer",
                opacity: customCount === 0 ? 0.5 : 1,
              }}
            >
              {t("agentmap.reset")}
            </button>
          </div>
          <div
            style={{
              marginTop: 10,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
              gap: 10,
            }}
          >
            {AGENT_IDS.map((agent) => {
              const onCount = ALL_SOURCES.filter((s) => isOn(agent, s)).length;
              return (
                <div
                  key={agent}
                  data-testid={`agent-card-${agent}`}
                  style={{
                    borderRadius: T.radius.md,
                    border: `1px solid ${T.border}`,
                    background: "rgba(0,0,0,0.18)",
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "-0.01em" }}>
                      {t(`agentmap.agent.${agent}`)}
                    </span>
                    <span style={{ fontSize: 9, color: T.muted, letterSpacing: "0.08em" }}>
                      {onCount}/{ALL_SOURCES.length}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {ALL_SOURCES.map((sid) => {
                      const on = isOn(agent, sid);
                      const def = isDefault(agent, sid);   // part of the feature's original set
                      const changed = on !== def;          // toggled away from its default
                      return (
                        <button
                          key={sid}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          data-testid={`source-${agent}-${sid}`}
                          onClick={() => toggle(agent, sid)}
                          style={{
                            display: "flex", alignItems: "center", gap: 7, width: "100%",
                            background: "transparent", border: "none", padding: "3px 2px",
                            borderRadius: T.radius.sm, cursor: "pointer", textAlign: "left",
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              border: on ? "none" : `1px solid ${T.border}`,
                              background: on ? "rgba(196,148,82,0.22)" : "transparent",
                              color: "#e4c08c", fontSize: 10, fontWeight: 700, lineHeight: 1,
                              transition: "background 120ms ease",
                            }}
                          >
                            {on ? "✓" : ""}
                          </span>
                          <span style={{ fontSize: 11, opacity: on ? 0.5 : 0.25 }}>{SOURCE_ICON[sid]}</span>
                          <span
                            style={{
                              fontSize: 11.5,
                              color: on ? T.mutedMid : T.muted,
                              textDecoration: on ? "none" : "line-through",
                            }}
                          >
                            {t(`agentmap.src.${sid}`)}
                          </span>
                          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
                            {changed && (
                              <span
                                aria-label="changed from default"
                                title={t("agentmap.changed")}
                                style={{ width: 5, height: 5, borderRadius: "50%", background: T.accent, boxShadow: `0 0 5px ${T.accent}` }}
                              />
                            )}
                            {def ? (
                              <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted, opacity: 0.75 }}>
                                {t("agentmap.default")}
                              </span>
                            ) : on ? (
                              <span style={{ fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: "#86a378" }}>
                                {t("agentmap.added")}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
