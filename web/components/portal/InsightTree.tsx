"use client";

import React, { Fragment, useMemo, useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import MarkdownSummary from "@/components/dashboard/MarkdownSummary";
import Spinner from "@/components/dashboard/Spinner";
import ThoughtLine, { plainThought } from "@/components/dashboard/ThoughtLine";
import LiveSources from "@/components/dashboard/LiveSources";

// The client portal's "Understand your body" mind-map. Adapted from the trainer
// Knowledge base's DocChunkTree (same SVG-bezier + HTML-node approach, no deps),
// generalised to a tabbed, arbitrary-depth tree fetched lazily: each TAB is its
// own tree rooted in the client's current background (their goal). Expanding any
// node calls the insight-tree flow to grow a short personalised insight + the
// next children, grounded in live data — so it updates as new progress lands.
//
// Tab 1 "Your Journey" walks goal → current problem (injuries / stamina /
// strength / mindset) → programme & body status → daily progress. Tabs 2 & 3
// surface fitness-health knowledge and nutrition. All start from the same root.

type Child = { label: string; emoji?: string };
type Source = { title: string; url: string };

type Node = {
  id: string;
  label: string;
  emoji: string;
  branch: string;            // health | progress | injuries | stamina | strength | mental | knowledge | nutrition ("" = root)
  pathLabels: string[];      // ancestor labels below the root (excl. this node)
  isBranch: boolean;         // a seeded top-level node (bold + coloured)
  color: string;
  insight?: string;
  sources?: Source[];
  children?: Node[];         // undefined ⇒ not yet loaded
  open: boolean;
  loading: boolean;
};

type Seed = { branch: string; labelKey: string; emoji: string; color: string };
type Tab = { id: string; labelKey: string; rootEmoji: string; seeds: Seed[] };

const TABS: Tab[] = [
  {
    id: "journey",
    labelKey: "insight.tab.journey",
    rootEmoji: "🎯",
    seeds: [
      { branch: "injuries", labelKey: "insight.branch.injuries", emoji: "🩹", color: "#d9a441" },
      { branch: "stamina",  labelKey: "insight.branch.stamina",  emoji: "🫁", color: "#7a948c" },
      { branch: "strength", labelKey: "insight.branch.strength", emoji: "💪", color: "#d98a8a" },
      { branch: "mental",   labelKey: "insight.branch.mental",   emoji: "🧠", color: "#a78fd0" },
    ],
  },
  {
    id: "knowledge",
    labelKey: "insight.tab.knowledge",
    rootEmoji: "💡",
    seeds: [
      { branch: "knowledge", labelKey: "insight.k.principles", emoji: "📚", color: "#7a948c" },
      { branch: "knowledge", labelKey: "insight.k.recovery",   emoji: "🛌", color: "#86a378" },
      { branch: "knowledge", labelKey: "insight.k.conditions", emoji: "❤️", color: "#d98a8a" },
    ],
  },
  {
    id: "nutrition",
    labelKey: "insight.tab.nutrition",
    rootEmoji: "🥗",
    seeds: [
      { branch: "nutrition", labelKey: "insight.n.goalfood", emoji: "🍽️", color: "#86a378" },
      { branch: "nutrition", labelKey: "insight.n.timing",   emoji: "⏱️", color: "#d9a441" },
      { branch: "nutrition", labelKey: "insight.n.watch",    emoji: "⚠️", color: "#d98a8a" },
    ],
  },
];

// ── layout constants (left→right columns, like DocChunkTree) ──────────────────
const NODE_W = 200, NODE_H = 42, COL_GAP = 56, ROW_H = 56, PAD = 16;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
};

function mapNode(node: Node, target: string, fn: (n: Node) => Node): Node {
  if (node.id === target) return fn(node);
  if (!node.children) return node;
  return { ...node, children: node.children.map((c) => mapNode(c, target, fn)) };
}

type Placed = { node: Node; depth: number; x: number; y: number; cy: number };

function layout(root: Node) {
  const placed: Placed[] = [];
  let cursorY = PAD;
  let maxDepth = 0;
  function walk(node: Node, depth: number): number {
    maxDepth = Math.max(maxDepth, depth);
    const x = PAD + depth * (NODE_W + COL_GAP);
    const kids = node.open && node.children ? node.children : [];
    let cy: number;
    if (kids.length === 0) {
      cy = cursorY + NODE_H / 2;
      cursorY += ROW_H;
    } else {
      const cys = kids.map((c) => walk(c, depth + 1));
      cy = (cys[0] + cys[cys.length - 1]) / 2;
    }
    placed.push({ node, depth, x, y: cy - NODE_H / 2, cy });
    return cy;
  }
  walk(root, 0);
  const height = Math.max(cursorY - ROW_H + NODE_H + PAD, NODE_H + PAD * 2);
  const width = PAD * 2 + (maxDepth + 1) * NODE_W + maxDepth * COL_GAP;
  return { placed, width, height };
}

// `clientId` is supplied on the trainer side to preview a specific client's tree
// (the API verifies the trainer owns that client). Omitted on the client portal,
// where the viewer is locked to their own row.
export default function InsightTree({ clientName, clientGoal, clientId }: { clientName: string; clientGoal?: string | null; clientId?: string }) {
  const { t } = useI18n();
  const stream = useAgentStream();

  // Root label = the client's current background anchor (their goal), falling
  // back to their name. Each tab gets its own lazy tree seeded from TABS.
  const rootLabel = (clientGoal && clientGoal.trim()) || clientName || t("insight.you");

  function seedTab(tab: Tab): Node {
    return {
      id: `${tab.id}:root`,
      label: rootLabel,
      emoji: tab.rootEmoji,
      branch: "",
      pathLabels: [],
      isBranch: false,
      color: "#8f8fd0",
      open: true,
      loading: false,
      children: tab.seeds.map((s, i) => ({
        id: `${tab.id}:b${i}`,
        label: t(s.labelKey),
        emoji: s.emoji,
        branch: s.branch,
        pathLabels: [],
        isBranch: true,
        color: s.color,
        open: false,
        loading: false,
      })),
    };
  }

  const [roots, setRoots] = useState<Record<string, Node>>(() =>
    Object.fromEntries(TABS.map((tab) => [tab.id, seedTab(tab)])),
  );
  const [activeTab, setActiveTab] = useState<string>(TABS[0].id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Grounding controls (apply to every expansion). Web is opt-in; depth (1–3)
  // is the "think deeper" slider that raises the agent's tool-call budget.
  const [webSearch, setWebSearch] = useState(false);
  const [depth, setDepth] = useState(1);
  const depthLabels = ["", t("insight.depthQuick"), t("insight.depthBalanced"), t("insight.depthDeep")];

  const root = roots[activeTab];
  const { placed, width, height } = useMemo(() => layout(root), [root]);
  const byId = useMemo(() => {
    const m = new Map<string, Placed>();
    for (const p of placed) m.set(p.node.id, p);
    return m;
  }, [placed]);

  const selected = selectedId ? placed.find((p) => p.node.id === selectedId)?.node ?? null : null;

  function updateRoot(id: string, fn: (n: Node) => Node) {
    setRoots((rs) => ({ ...rs, [activeTab]: mapNode(rs[activeTab], id, fn) }));
  }

  async function loadChildren(node: Node) {
    setBusyId(node.id);
    updateRoot(node.id, (n) => ({ ...n, loading: true, open: true }));
    try {
      const result = await stream.start("/api/ai/insight-tree", {
        branch: node.branch,
        node_label: node.label,
        node_path: node.pathLabels,
        web_search: webSearch,
        depth,
        ...(clientId ? { client_id: clientId } : {}),
      });
      const insight = String(result?.insight ?? "");
      const rawKids = Array.isArray(result?.children) ? (result!.children as Child[]) : [];
      const sources = Array.isArray(result?.sources) ? (result!.sources as Source[]) : [];
      const childPath = [...node.pathLabels, node.label];
      const children: Node[] = rawKids.slice(0, 5).map((c, i) => ({
        id: `${node.id}/${i}`,
        label: String(c.label ?? "—"),
        emoji: (c.emoji && String(c.emoji).trim()) || "🔎",
        branch: node.branch,
        pathLabels: childPath,
        isBranch: false,
        color: node.color,
        open: false,
        loading: false,
      }));
      updateRoot(node.id, (n) => ({ ...n, loading: false, open: true, insight, sources, children }));
    } catch {
      updateRoot(node.id, (n) => ({ ...n, loading: false, open: false }));
    } finally {
      setBusyId(null);
    }
  }

  function onNodeClick(node: Node) {
    if (node.branch === "") return; // root
    setSelectedId(node.id);
    if (node.children === undefined && !node.loading) loadChildren(node);
  }

  function onToggle(e: React.MouseEvent, node: Node) {
    e.stopPropagation();
    if (node.children === undefined) { loadChildren(node); return; }
    updateRoot(node.id, (n) => ({ ...n, open: !n.open }));
  }

  const nodeBox: React.CSSProperties = {
    position: "absolute", display: "flex", alignItems: "center", gap: 8,
    padding: "0 12px", borderRadius: 10, boxSizing: "border-box",
    background: "rgba(255,252,245,0.05)", border: `1px solid ${T.border}`,
    fontSize: 12, color: T.text, cursor: "pointer",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <style>{`@keyframes spin-emoji { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSelectedId(null); }}
              style={{
                border: `1px solid ${active ? T.accent : T.border}`,
                background: active ? `${T.accent}1f` : "transparent",
                borderRadius: T.radius.pill, padding: "6px 14px",
                color: active ? T.text : T.mutedMid, fontSize: 12, cursor: "pointer",
                fontWeight: active ? 600 : 400,
              }}
            >
              {t(tab.labelKey)}
            </button>
          );
        })}
      </div>

      {/* ── Grounding controls: web toggle + "think deeper" slider ── */}
      <div className="glass" style={{
        borderRadius: T.radius.card, padding: "10px 16px", display: "flex",
        alignItems: "center", gap: 20, flexWrap: "wrap",
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.mutedMid, cursor: "pointer" }}>
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} style={{ accentColor: T.accent, cursor: "pointer" }} />
          <span>🌐 {t("insight.webToggle")}</span>
        </label>
        <span style={{ fontSize: 11, color: T.muted }}>
          {webSearch ? t("insight.webOn") : t("insight.webOff")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <span style={{ fontSize: 12, color: T.mutedMid, whiteSpace: "nowrap" }}>🧠 {t("insight.depthLabel")}</span>
          <input
            type="range" min={1} max={3} step={1} value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            style={{ accentColor: T.accent, cursor: "pointer", width: 110 }}
          />
          <span style={{ fontSize: 11, color: T.accent, fontWeight: 600, minWidth: 56 }}>{depthLabels[depth]}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "stretch" }}>
        {/* ── Mind-map canvas (full width) ── */}
        <div className="glass" style={{ borderRadius: T.radius.card, padding: 12, width: "100%", overflowX: "auto" }}>
          <div style={{ position: "relative", width, height, minWidth: "100%" }}>
            {/* connectors */}
            <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
              {placed.flatMap((p) =>
                (p.node.open && p.node.children ? p.node.children : []).map((c) => {
                  const cp = byId.get(c.id);
                  if (!cp) return null;
                  return (
                    <path key={`${p.node.id}->${c.id}`}
                      d={curve(p.x + NODE_W, p.cy, cp.x, cp.cy)}
                      fill="none" stroke={c.color} strokeOpacity={0.4} strokeWidth={1.5} />
                  );
                })
              )}
            </svg>

            {placed.map((p) => {
              const n = p.node;
              const isRoot = n.branch === "";
              const selectedHere = n.id === selectedId;
              const spinning = n.loading || busyId === n.id;
              return (
                <Fragment key={n.id}>
                  <div
                    onClick={() => onNodeClick(n)}
                    title={n.label}
                    style={{
                      ...nodeBox, left: p.x, top: p.y, width: NODE_W, height: NODE_H,
                      cursor: isRoot ? "default" : "pointer",
                      fontWeight: n.isBranch || isRoot ? 600 : 400,
                      background: isRoot ? "rgba(123,123,176,0.22)" : selectedHere ? `${n.color}26` : "rgba(255,252,245,0.05)",
                      border: `1px solid ${selectedHere ? n.color + "80" : isRoot ? "rgba(123,123,176,0.5)" : T.border}`,
                    }}
                  >
                    <span style={{ fontSize: 13, flexShrink: 0 }}>{n.emoji}</span>
                    <span style={{
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
                      color: n.isBranch ? n.color : T.text,
                    }}>{n.label}</span>
                  </div>

                  {!isRoot && (
                    <button
                      onClick={(e) => onToggle(e, n)}
                      title={n.open ? t("insight.collapse") : t("insight.expand")}
                      disabled={spinning}
                      style={{
                        position: "absolute", left: p.x + NODE_W + 8, top: p.cy - 11,
                        width: 22, height: 22, borderRadius: 99, padding: 0,
                        cursor: spinning ? "default" : "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        background: n.open ? `${n.color}2a` : "rgba(255,252,245,0.06)",
                        border: `1px solid ${n.open ? n.color + "80" : T.border}`,
                        color: n.open ? n.color : T.muted, fontSize: 11, lineHeight: 1,
                        transform: spinning ? "none" : n.open ? "rotate(90deg)" : "none", transition: "transform 0.15s",
                      }}
                    >
                      {spinning
                        ? <span style={{ display: "inline-block", animation: "spin-emoji 1s linear infinite", fontSize: 12, lineHeight: 1 }}>🌱</span>
                        : "›"}
                    </button>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* ── Detail card (below the map, full width) ── */}
        <div className="glass" style={{ borderRadius: T.radius.card, padding: 18, width: "100%" }}>
          {!selected ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#e4c08c", lineHeight: 1.5 }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>👆</span>
              <span>{t("insight.reminder")}</span>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em", marginBottom: 10 }}>
                {selected.emoji} {selected.label}
              </div>
              {selected.loading || busyId === selected.id ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "#e4c08c" }}>
                    <Spinner emoji="🌱" label={plainThought(stream.thoughts[stream.thoughts.length - 1]) ?? t("insight.thinking")} />
                  </div>
                  {/* Agent thoughts, streamed one line at a time */}
                  {stream.thoughts.length > 0 && (
                    <div style={{
                      display: "flex", flexDirection: "column", gap: 4,
                      padding: "8px 12px", background: "rgba(0,0,0,0.18)",
                      borderRadius: 8, borderLeft: `2px solid ${T.border}`,
                      maxHeight: 160, overflowY: "auto",
                    }}>
                      {stream.thoughts.map((line, i) => (
                        <div key={i} style={{
                          fontSize: 11, color: T.muted, lineHeight: 1.45, fontFamily: T.font.mono,
                          opacity: i === stream.thoughts.length - 1 ? 1 : 0.55,
                        }}>
                          <ThoughtLine line={line} />
                        </div>
                      ))}
                    </div>
                  )}
                  <LiveSources sources={stream.sources} />
                </div>
              ) : selected.insight ? (
                <>
                  <MarkdownSummary text={selected.insight} />
                  {selected.sources && selected.sources.length > 0 && (
                    <div style={{ marginTop: 12, borderTop: `1px solid ${T.border}`, paddingTop: 10 }}>
                      <div style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
                        color: "#e4c08c", marginBottom: 6,
                      }}>
                        {t("insight.sources")}
                      </div>
                      <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                        {selected.sources.map((s, i) => (
                          <li key={i} style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
                            <a href={s.url} target="_blank" rel="noopener noreferrer"
                              style={{ color: T.accent, textDecoration: "underline" }}>
                              {s.title || s.url}
                            </a>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12, color: T.muted }}>{t("insight.tapToExplore")}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
