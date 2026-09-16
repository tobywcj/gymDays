"use client";

import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import Spinner from "@/components/dashboard/Spinner";

type TFn = (key: string) => string;

// ── Types ────────────────────────────────────────────────────────────────────

type SourceType = "url" | "pdf" | "docx" | "pptx" | "article";
type DocStatus = "processing" | "ready" | "error";

type KnowledgeDoc = {
  id: string;
  title: string;
  source_type: SourceType;
  source_url: string | null;
  default_tags: string[];
  status: DocStatus;
  chunk_count: number;
  error_detail: string | null;
  progress_stage: string | null;
  progress_done: number;
  progress_total: number;
  created_at: string;
};

const AGENTS = ["progress", "planner", "nutrition", "messaging"] as const;
type AgentTag = (typeof AGENTS)[number];

// Per-agent RAG memory: the chunks an agent can retrieve, grouped by source doc.
type ChunkLeaf = {
  id: string; chunk_index: number; title: string | null; content: string; reason?: string;
  // Cosine similarity of this chunk to each agent's domain (unassigned chunks only).
  agent_sims?: Partial<Record<AgentTag, number>>;
};
type AgentDocGroup = { doc_id: string; title: string; source_type: SourceType; learns: string[]; chunks: ChunkLeaf[] };
type AgentMemory = { chunk_count: number; docs: AgentDocGroup[] };
type AgentMemoryMap = Record<AgentTag, AgentMemory>;

function stageLabel(stage: string | null, done: number, total: number, t: TFn): string {
  switch (stage) {
    case "queued":     return t("kb.stage.queued");
    case "extracting": return t("kb.stage.extracting");
    case "chunking":   return t("kb.stage.chunking");
    case "tagging":    return total > 0 ? `${t("kb.stage.tagging")} ${done}/${total}…` : `${t("kb.stage.tagging")}…`;
    case "saving":     return total > 0 ? `${t("kb.stage.saving")} ${done}/${total}…` : `${t("kb.stage.saving")}…`;
    default:           return t("kb.stage.analysing");
  }
}

// ── Design constants ─────────────────────────────────────────────────────────

const SOURCE_BADGE: Record<SourceType, { label: string; color: string; bg: string }> = {
  pdf:     { label: "PDF",     color: "#e4c08c", bg: "rgba(196,148,82,0.22)"  },
  pptx:    { label: "PPTX",   color: "#e89878", bg: "rgba(196,108,76,0.22)"  },
  docx:    { label: "DOCX",   color: "#b0d4a0", bg: "rgba(98,132,88,0.22)"   },
  url:     { label: "URL",    color: "#7a948c", bg: "rgba(122,148,140,0.22)" },
  article: { label: "Text",   color: "#bcd3b8", bg: "rgba(140,164,140,0.22)" },
};

const AGENT_COLORS: Record<AgentTag, string> = {
  progress:  "#e4c08c",
  planner:   "#e89878",
  nutrition: "#b0d4a0",
  messaging: "#bcd3b8",
};

const AGENT_EMOJI: Record<AgentTag, string> = {
  progress:  "📈",
  planner:   "🗓️",
  nutrition: "🥗",
  messaging: "💬",
};

// Rotating markers for the per-doc "what this agent learns" bullets, so each
// learning reads as a distinct, lively takeaway rather than a flat list.
const BULLET_EMOJI = ["💡", "🎯", "🔑", "📌"] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fileExtToSourceType(filename: string): SourceType {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf")  return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "pptx" || ext === "ppt") return "pptx";
  return "article";
}

// ── Knowledge distribution ─────────────────────────────────────────────────────
// How the chunk library is spread across the agents. Untagged chunks are shared by
// every agent, so the per-agent counts can sum to more than the raw chunk total —
// we show each agent's share of that combined reach.

function KnowledgeDistribution({ agentMem }: { agentMem: AgentMemoryMap }) {
  const { t } = useI18n();
  const counts = AGENTS.map((a) => ({ agent: a, count: agentMem[a]?.chunk_count ?? 0 }));
  const total = counts.reduce((s, c) => s + c.count, 0);
  const max = Math.max(1, ...counts.map((c) => c.count));

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 20, display: "flex", flexDirection: "column", gap: 14, height: "100%", boxSizing: "border-box" }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{t("kb.distribution")}</div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{t("kb.distributionSub")}</div>
      </div>

      {total === 0 ? (
        <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>{t("kb.memoryEmpty")}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {counts.map(({ agent, count }) => {
            const color = AGENT_COLORS[agent];
            const pct = Math.round((count / total) * 100);
            return (
              <div key={agent} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                  <span style={{ fontSize: 13 }}>{AGENT_EMOJI[agent]}</span>
                  <span style={{ color, fontWeight: 700 }}>{t(`role.${agent}`)}</span>
                  <span style={{ marginLeft: "auto", color: T.muted, fontFamily: T.font.mono, fontSize: 10 }}>
                    {count} · {pct}%
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 99, background: "rgba(255,252,245,0.05)", overflow: "hidden" }}>
                  <div style={{
                    width: `${(count / max) * 100}%`, height: "100%", borderRadius: 99,
                    background: `linear-gradient(90deg, ${color}cc, ${color}88)`,
                    transition: "width 0.4s ease",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Agent memory card (summary of the sections each agent can retrieve) ─────────

function AgentMemoryCard({
  agent, mem, onRefresh, refreshing,
}: {
  agent: AgentTag;
  mem: AgentMemory;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useI18n();
  const color = AGENT_COLORS[agent];
  return (
    <div className="glass" style={{ borderRadius: T.radius.md, padding: 14, display: "flex", flexDirection: "column", gap: 10, boxSizing: "border-box" }}>
      {/* Header (stays fixed; body below scrolls) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15 }}>{AGENT_EMOJI[agent]}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: "0.02em" }}>
          {t(`role.${agent}`)}
        </span>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600,
          background: `${color}1f`, color, border: `1px solid ${color}40`,
        }}>
          {mem.chunk_count} {mem.chunk_count !== 1 ? t("kb.chunks") : t("kb.chunk")}
        </span>
        {mem.docs.length > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: T.muted }}>
            {mem.docs.length} {mem.docs.length !== 1 ? t("kb.sources") : t("kb.source")}
          </span>
        )}
        {/* Refresh — re-reads this agent's memory summary into the UI only.
            Read-only: does not touch the upload / ingest pipeline. */}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          title={t("kb.refreshMemory")}
          style={{
            marginLeft: mem.docs.length > 0 ? 6 : "auto",
            flexShrink: 0, background: "transparent", border: `1px solid ${T.border}`,
            color: refreshing ? color : T.muted, cursor: refreshing ? "default" : "pointer",
            width: 24, height: 24, borderRadius: 6, padding: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, lineHeight: 1,
          }}
          onMouseEnter={(e) => { if (!refreshing) e.currentTarget.style.color = color; }}
          onMouseLeave={(e) => { if (!refreshing) e.currentTarget.style.color = T.muted; }}
        >
          <span style={{
            display: "inline-block",
            animation: refreshing ? "kb-spin 0.7s linear infinite" : "none",
          }}>↻</span>
        </button>
      </div>

      {mem.docs.length === 0 ? (
        <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic" }}>
          {t("kb.memoryEmpty")}
        </div>
      ) : (
        <div style={{
          display: "flex", flexDirection: "column", gap: 12,
          maxHeight: 220, overflowY: "auto", paddingRight: 4, marginRight: -4,
        }}>
          {mem.docs.map((d) => {
            const badge = SOURCE_BADGE[d.source_type];
            // Fallback when the LLM bullets aren't generated yet: use distinct chunk
            // titles as provisional bullets so the card is never empty.
            const fallback = Array.from(new Set(
              d.chunks.map((c) => (c.title?.trim() || "")).filter(Boolean)
            )).slice(0, 4);
            const bullets = d.learns.length > 0 ? d.learns : fallback;
            return (
              <div key={d.doc_id} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {/* Source heading */}
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <span style={{
                    fontSize: 8, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                    background: badge.bg, color: badge.color, letterSpacing: "0.05em", flexShrink: 0,
                  }}>
                    {badge.label}
                  </span>
                  <span title={d.title} style={{
                    fontSize: 12, fontWeight: 600, color: T.text, lineHeight: 1.2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
                  }}>
                    {d.title}
                  </span>
                  <span style={{ fontSize: 9, color: T.muted, flexShrink: 0, fontFamily: T.font.mono }}>
                    {d.chunks.length}
                  </span>
                </div>
                {/* What THIS agent learns from this doc — emoji bullet points */}
                {bullets.length > 0 ? (
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                    {bullets.map((b, i) => (
                      <li key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: 6,
                        fontSize: 11, color: T.mutedMid, lineHeight: 1.4,
                      }}>
                        <span style={{ fontSize: 11, flexShrink: 0, lineHeight: 1.4 }}>
                          {BULLET_EMOJI[i % BULLET_EMOJI.length]}
                        </span>
                        <span style={{ minWidth: 0 }}>{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ fontSize: 11, color: T.muted, fontStyle: "italic", paddingLeft: 2 }}>
                    {t("kb.noSummary")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Unassigned bucket ──────────────────────────────────────────────────────────
// Chunks the auto-tagger matched to no agent. They are shelved (retrievable by no
// agent) until the trainer reviews each one: assign it to the agent(s) it belongs
// to, or delete it. Nothing silently rots.

function UnassignedMemoryCard({
  mem, onAssign, onDelete,
}: {
  mem: AgentMemory;
  onAssign: (chunkId: string, tags: AgentTag[]) => Promise<void>;
  onDelete: (chunkId: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const color = "#d9a441"; // amber: needs attention, not an error
  const [sel, setSel] = useState<Record<string, AgentTag[]>>({});
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Which chunks are expanded to show their full content for review.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const delTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function toggleExpand(chunkId: string) {
    setExpanded((prev) => ({ ...prev, [chunkId]: !prev[chunkId] }));
  }

  function toggle(chunkId: string, a: AgentTag) {
    setSel((prev) => {
      const cur = prev[chunkId] ?? [];
      return { ...prev, [chunkId]: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] };
    });
  }
  function armDel(chunkId: string) {
    if (delTimer.current) clearTimeout(delTimer.current);
    setConfirmDel(chunkId);
    delTimer.current = setTimeout(() => setConfirmDel(null), 4000);
  }
  async function doAssign(chunkId: string) {
    const tags = sel[chunkId] ?? [];
    if (tags.length === 0) return;
    setBusy(chunkId);
    try { await onAssign(chunkId, tags); } finally { setBusy(null); }
  }
  async function doDelete(chunkId: string) {
    setBusy(chunkId);
    try {
      await onDelete(chunkId);
    } catch (e) {
      // Keep the chunk visible and tell the trainer it didn't go through.
      console.error("[knowledge] chunk delete failed:", e);
      alert(`${t("kb.deleteFailed")} (${(e as Error).message})`);
    } finally {
      setBusy(null);
      setConfirmDel(null);
    }
  }

  return (
    <div className="glass" style={{
      borderRadius: T.radius.md, padding: 14, display: "flex", flexDirection: "column",
      gap: 10, boxSizing: "border-box", border: `1px solid ${color}33`, marginTop: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15 }}>📥</span>
        <span style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: "0.02em" }}>
          {t("kb.unassigned")}
        </span>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 600,
          background: `${color}1f`, color, border: `1px solid ${color}40`,
        }}>
          {mem.chunk_count} {mem.chunk_count !== 1 ? t("kb.chunks") : t("kb.chunk")}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: T.muted }}>{t("kb.unassignedSub")}</span>
      </div>

      {/* Scrollable per-chunk review list */}
      <div style={{
        display: "flex", flexDirection: "column", gap: 10,
        maxHeight: 360, overflowY: "auto", paddingRight: 4, marginRight: -4,
      }}>
        {mem.docs.map((d) => {
          const badge = SOURCE_BADGE[d.source_type];
          return (
            <div key={d.doc_id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {/* Source heading */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: "1px 6px", borderRadius: 99,
                  background: badge.bg, color: badge.color, letterSpacing: "0.05em", flexShrink: 0,
                }}>
                  {badge.label}
                </span>
                <span title={d.title} style={{
                  fontSize: 11, fontWeight: 600, color: T.mutedMid, lineHeight: 1.2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1,
                }}>
                  {d.title}
                </span>
              </div>

              {/* One reviewable row per chunk */}
              {d.chunks.map((c) => {
                const picked = sel[c.id] ?? [];
                const isBusy = busy === c.id;
                const full = c.content?.trim().replace(/\s+/g, " ") || "";
                const isLong = full.length > 160;
                const isOpen = !!expanded[c.id];
                const summary = isLong && !isOpen ? full.slice(0, 160) : full;
                // Nearest agent = highest domain similarity. Used to badge the closest
                // button so the trainer's eye lands on the most likely home first.
                const sims = c.agent_sims ?? {};
                const nearest = AGENTS.reduce<AgentTag | null>(
                  (best, a) => (sims[a] != null && (best == null || (sims[a] as number) > (sims[best] as number)) ? a : best),
                  null,
                );
                return (
                  <div key={c.id} style={{
                    display: "flex", flexDirection: "column", gap: 6,
                    padding: "8px 10px", borderRadius: 8,
                    background: "rgba(255,252,245,0.03)", border: `1px solid ${T.border}`,
                    opacity: isBusy ? 0.5 : 1,
                  }}>
                    {c.title?.trim() && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: T.text, lineHeight: 1.3 }}>
                        {c.title.trim()}
                      </div>
                    )}
                    <div style={{
                      fontSize: 11, color: T.mutedMid, lineHeight: 1.5,
                      whiteSpace: isOpen ? "pre-wrap" : "normal",
                      maxHeight: isOpen ? 260 : undefined,
                      overflowY: isOpen ? "auto" : undefined,
                    }}>
                      {summary}{isLong && !isOpen ? "…" : ""}
                    </div>
                    {/* Review the full chunk text before assigning / deleting it */}
                    {isLong && (
                      <button
                        type="button"
                        onClick={() => toggleExpand(c.id)}
                        style={{
                          alignSelf: "flex-start", background: "transparent", border: "none",
                          padding: 0, cursor: "pointer", fontSize: 10, fontWeight: 600,
                          color: T.accent, textDecoration: "underline", textUnderlineOffset: 2,
                        }}
                      >
                        {isOpen ? t("kb.showLess") : t("kb.readMore")}
                      </button>
                    )}

                    {/* Why it was shelved — helps the assign/delete decision */}
                    {c.reason && (
                      <div style={{ fontSize: 10, color: color, fontStyle: "italic", opacity: 0.9 }}>
                        ⓘ {t(`kb.reason.${c.reason}`)}
                      </div>
                    )}

                    {/* Assign chips + actions */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {AGENTS.map((a) => {
                        const on = picked.includes(a);
                        const ac = AGENT_COLORS[a];
                        const sim = sims[a];
                        const isNearest = a === nearest && sim != null;
                        return (
                          <button
                            key={a}
                            onClick={() => toggle(c.id, a)}
                            disabled={isBusy}
                            title={sim != null
                              ? `${t(`role.${a}`)} · ${(sim * 100).toFixed(0)}% ${t("kb.similarity")}`
                              : t(`role.${a}`)}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 99,
                              cursor: isBusy ? "default" : "pointer",
                              background: on ? `${ac}2a` : isNearest ? `${ac}14` : "transparent",
                              color: on ? ac : isNearest ? ac : T.muted,
                              border: `1px solid ${on ? ac + "80" : isNearest ? ac + "55" : T.border}`,
                            }}
                          >
                            <span style={{ fontSize: 11 }}>{AGENT_EMOJI[a]}</span>
                            {t(`role.${a}`)}
                            {sim != null && (
                              <span style={{
                                fontFamily: T.font.mono, fontSize: 9, fontWeight: 700,
                                color: on || isNearest ? ac : T.muted, opacity: on || isNearest ? 1 : 0.7,
                              }}>
                                {isNearest && "★"}{(sim * 100).toFixed(0)}%
                              </span>
                            )}
                          </button>
                        );
                      })}

                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        {picked.length > 0 && (
                          <button
                            onClick={() => doAssign(c.id)}
                            disabled={isBusy}
                            style={{
                              fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                              cursor: isBusy ? "default" : "pointer",
                              background: "#6f9e6f33", color: "#9fd49f", border: "1px solid #6f9e6f66",
                            }}
                          >
                            {t("kb.assign")}{picked.length > 1 ? ` (${picked.length})` : ""}
                          </button>
                        )}
                        <button
                          onClick={() => (confirmDel === c.id ? doDelete(c.id) : armDel(c.id))}
                          disabled={isBusy}
                          style={{
                            fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 99,
                            cursor: isBusy ? "default" : "pointer",
                            background: confirmDel === c.id ? "#c45c4c33" : "transparent",
                            color: confirmDel === c.id ? "#f0a090" : T.muted,
                            border: `1px solid ${confirmDel === c.id ? "#c45c4c66" : T.border}`,
                          }}
                        >
                          {confirmDel === c.id ? t("kb.confirmDelete") : t("kb.deleteChunk")}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Document chunk tree (collapsible per-doc view of its chunks) ────────────────
// Lazy-loads a doc's chunks the first time it's expanded and renders them as a tree
// grouped by the agent(s) each chunk is tagged for — so the trainer can see exactly
// how a document was split and routed.

type DocChunk = {
  id: string;
  chunk_index: number;
  title: string | null;
  content: string;
  agent_tags: string[];
  tags_confirmed: boolean;
};

const UNASSIGNED_SENTINEL = "__unassigned__";

// Branch order + presentation for the tree groupings.
const TREE_BRANCHES: { key: string; labelKey: string; color: string; emoji: string }[] = [
  { key: "progress",   labelKey: "role.progress",   color: AGENT_COLORS.progress,  emoji: AGENT_EMOJI.progress  },
  { key: "planner",    labelKey: "role.planner",    color: AGENT_COLORS.planner,   emoji: AGENT_EMOJI.planner   },
  { key: "nutrition",  labelKey: "role.nutrition",  color: AGENT_COLORS.nutrition, emoji: AGENT_EMOJI.nutrition },
  { key: "messaging",  labelKey: "role.messaging",  color: AGENT_COLORS.messaging, emoji: AGENT_EMOJI.messaging },
  { key: "untagged",   labelKey: "kb.untaggedAll",  color: "#7a948c",              emoji: "🌐" },
  { key: "unassigned", labelKey: "kb.unassigned",   color: "#d9a441",              emoji: "📥" },
];

function DocChunkTree({ docId, title }: { docId: string; title: string }) {
  const { t } = useI18n();
  const [chunks, setChunks] = useState<DocChunk[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  // Which agent branches are drilled open to reveal their chunk leaves.
  const [openBranch, setOpenBranch] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/knowledge/docs/${docId}/chunks`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const j = await r.json();
        if (alive) { setChunks(j.chunks ?? []); setState("ready"); }
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => { alive = false; };
  }, [docId]);

  if (state === "loading") {
    return (
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 16px", fontSize: 11, color: T.muted }}>
        <Spinner emoji="🌿" label={t("kb.loadingChunks")} />
      </div>
    );
  }
  if (state === "error") {
    return (
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 16px", fontSize: 11, color: "#f87171" }}>
        {t("kb.chunksFailed")}
      </div>
    );
  }

  const all = chunks ?? [];
  if (all.length === 0) {
    return (
      <div style={{ borderTop: `1px solid ${T.border}`, padding: "10px 16px", fontSize: 11, color: T.muted, fontStyle: "italic" }}>
        {t("kb.emptyChunks")}
      </div>
    );
  }

  // Group chunks into branches; a chunk tagged for several agents appears under each.
  const grouped: Record<string, DocChunk[]> = {};
  for (const c of all) {
    const tags = c.agent_tags ?? [];
    if (tags.length === 0) {
      (grouped.untagged ||= []).push(c);
    } else {
      for (const tg of tags) {
        const key = tg === UNASSIGNED_SENTINEL ? "unassigned" : tg;
        (grouped[key] ||= []).push(c);
      }
    }
  }

  const leafLabel = (c: DocChunk) =>
    c.title?.trim() || c.content?.trim().replace(/\s+/g, " ").slice(0, 90) || "—";

  // ── Horizontal mind-map layout ──────────────────────────────────────────────
  // Root (doc) on the left → agent branches fanning out right, each drillable into
  // its chunk leaves in a third column. Positions are computed so an SVG layer can
  // draw smooth bezier connectors behind the HTML node boxes.
  const ROOT_X = 8, ROOT_W = 188, NODE_H = 38;
  const GAP1 = 60, BRANCH_X = ROOT_X + ROOT_W + GAP1, BRANCH_W = 184;
  const GAP2 = 46, LEAF_X = BRANCH_X + BRANCH_W + GAP2, LEAF_W = 248, LEAF_H = 30, LEAF_GAP = 8;
  const ROW_GAP = 16, PAD_Y = 14;

  const branches = TREE_BRANCHES
    .map((b) => ({ ...b, chunks: grouped[b.key] ?? [] }))
    .filter((b) => b.chunks.length);

  let y = PAD_Y;
  const laid = branches.map((b) => {
    const open = !!openBranch[b.key];
    const top = y;
    const centerY = top + NODE_H / 2;
    const leaves = open
      ? b.chunks.map((c, i) => ({ c, top: top + NODE_H + 8 + i * (LEAF_H + LEAF_GAP) }))
      : [];
    const blockH = open ? NODE_H + 8 + b.chunks.length * (LEAF_H + LEAF_GAP) : NODE_H;
    y = top + blockH + ROW_GAP;
    return { ...b, top, centerY, leaves, open };
  });

  const anyOpen = laid.some((b) => b.open);
  const height = Math.max(NODE_H + PAD_Y * 2, y - ROW_GAP + PAD_Y);
  const width = (anyOpen ? LEAF_X + LEAF_W : BRANCH_X + BRANCH_W) + 12;
  const rootCY = height / 2;

  // Smooth left→right S-curve between two anchor points.
  const curve = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = (x2 - x1) * 0.5;
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  };

  const nodeBox = {
    position: "absolute" as const, display: "flex", alignItems: "center", gap: 7,
    padding: "0 12px", borderRadius: 10, boxSizing: "border-box" as const,
    background: "rgba(255,252,245,0.05)", border: `1px solid ${T.border}`,
    fontSize: 12, color: T.text,
  };

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, padding: "8px 12px 12px", overflowX: "auto" }}>
      <div style={{ position: "relative", width, height, minWidth: "100%" }}>
        {/* Connector layer */}
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
          {laid.map((b) => (
            <path key={`r-${b.key}`} d={curve(ROOT_X + ROOT_W, rootCY, BRANCH_X, b.centerY)}
              fill="none" stroke="#8f8fd0" strokeOpacity={0.55} strokeWidth={1.6} />
          ))}
          {laid.flatMap((b) =>
            b.leaves.map((l) => (
              <path key={`l-${l.c.id}`} d={curve(BRANCH_X + BRANCH_W, b.centerY, LEAF_X, l.top + LEAF_H / 2)}
                fill="none" stroke={b.color} strokeOpacity={0.4} strokeWidth={1.4} />
            ))
          )}
        </svg>

        {/* Root (document) node */}
        <div title={title} style={{
          ...nodeBox, left: ROOT_X, top: rootCY - NODE_H / 2, width: ROOT_W, height: NODE_H,
          background: "rgba(123,123,176,0.22)", border: "1px solid rgba(123,123,176,0.5)", fontWeight: 600,
        }}>
          <span style={{ fontSize: 13 }}>📄</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{title}</span>
        </div>

        {/* Branch (agent) nodes + drill button + leaves */}
        {laid.map((b) => (
          <Fragment key={b.key}>
            <div style={{ ...nodeBox, left: BRANCH_X, top: b.top, width: BRANCH_W, height: NODE_H }}>
              <span style={{ fontSize: 13 }}>{b.emoji}</span>
              <span style={{ color: b.color, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                {t(b.labelKey)}
              </span>
              <span style={{ color: T.muted, fontFamily: T.font.mono, fontSize: 10, flexShrink: 0 }}>{b.chunks.length}</span>
            </div>
            {/* Drill-in toggle (the `>` chip) */}
            <button
              onClick={() => setOpenBranch((p) => ({ ...p, [b.key]: !p[b.key] }))}
              title={b.open ? t("kb.collapseChunks") : t("kb.expandChunks")}
              style={{
                position: "absolute", left: BRANCH_X + BRANCH_W + 8, top: b.centerY - 11,
                width: 22, height: 22, borderRadius: 99, padding: 0, cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: b.open ? `${b.color}2a` : "rgba(255,252,245,0.06)",
                border: `1px solid ${b.open ? b.color + "80" : T.border}`,
                color: b.open ? b.color : T.muted, fontSize: 11, lineHeight: 1,
                transform: b.open ? "rotate(90deg)" : "none", transition: "transform 0.15s",
              }}
            >
              ›
            </button>
            {/* Chunk leaves */}
            {b.leaves.map((l) => (
              <div key={l.c.id} title={l.c.content?.trim() || undefined} style={{
                ...nodeBox, left: LEAF_X, top: l.top, width: LEAF_W, height: LEAF_H,
                gap: 6, fontSize: 11, color: T.mutedMid,
              }}>
                <span style={{ fontFamily: T.font.mono, fontSize: 9, color: T.muted, flexShrink: 0 }}>#{l.c.chunk_index}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{leafLabel(l.c)}</span>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const { t, locale } = useI18n();
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  // Per-agent RAG memory (aggregated across all ready docs). Manual refresh only —
  // each card has its own refresh button; we don't auto-refetch on doc changes.
  const [agentMem, setAgentMem] = useState<AgentMemoryMap | null>(null);
  const [unassignedMem, setUnassignedMem] = useState<AgentMemory | null>(null);
  const [agentMemState, setAgentMemState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshingAgent, setRefreshingAgent] = useState<AgentTag | null>(null);

  // Which document cards have their chunk tree expanded.
  const [openDocs, setOpenDocs] = useState<Record<string, boolean>>({});
  const toggleDoc = (id: string) => setOpenDocs((p) => ({ ...p, [id]: !p[id] }));

  // Upload state
  const [sourceType, setSourceType] = useState<SourceType>("pdf");
  const [urlInput, setUrlInput] = useState("");
  const [articleText, setArticleText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation (two-click pattern)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function armDelete(id: string) {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDelId(id);
    confirmTimerRef.current = setTimeout(() => setConfirmDelId(null), 4000);
  }

  const fetchDocs = useCallback(async () => {
    try {
      const r = await fetch("/api/knowledge/docs");
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      // Server list is the source of truth — replacing state here also reconciles
      // away any optimistic upload row that never actually persisted.
      setDocs((await r.json()).docs ?? []);
      setDocsError(null);
    } catch (e) {
      // Don't silently keep stale/optimistic rows: surface the failure so an
      // upload that didn't persist can't masquerade as saved.
      setDocsError((e as Error).message);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  const fetchAgentMem = useCallback(async () => {
    try {
      // Pass the app-UI locale so the learning bullets come back translated.
      const r = await fetch(`/api/knowledge/agents?lang=${encodeURIComponent(locale)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      setAgentMem(j.agents ?? null);
      setUnassignedMem(j.unassigned ?? null);
      setAgentMemState("ready");
    } catch {
      setAgentMemState("error");
    }
  }, [locale]);

  // Triage an unassigned chunk: assign it to the chosen agent(s). Re-reads agent
  // memory (which also drops it from the unassigned bucket) and the docs counts.
  const handleAssignChunk = useCallback(async (chunkId: string, tags: AgentTag[]) => {
    const r = await fetch(`/api/knowledge/chunks/${chunkId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_tags: tags }),
    });
    if (!r.ok) return;
    await Promise.all([fetchAgentMem(), fetchDocs()]);
  }, [fetchAgentMem, fetchDocs]);

  const handleDeleteChunk = useCallback(async (chunkId: string) => {
    const r = await fetch(`/api/knowledge/chunks/${chunkId}`, { method: "DELETE" });
    // Surface a failed delete instead of silently leaving the chunk in place —
    // the caller relies on this throwing to keep the row and warn the trainer.
    if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    await Promise.all([fetchAgentMem(), fetchDocs()]);
  }, [fetchAgentMem, fetchDocs]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // Load agent memory once on mount. After that it only updates when the trainer
  // clicks the refresh button on a card (see handleRefreshAgent).
  useEffect(() => { fetchAgentMem(); }, [fetchAgentMem]);

  async function handleRefreshAgent(agent: AgentTag) {
    setRefreshingAgent(agent);
    await fetchAgentMem();
    setRefreshingAgent(null);
  }

  // Poll while any doc is processing (fast cadence to show stage transitions)
  useEffect(() => {
    const anyProcessing = docs.some((d) => d.status === "processing");
    if (!anyProcessing) return;
    const id = setInterval(fetchDocs, 1200);
    return () => clearInterval(id);
  }, [docs, fetchDocs]);

  async function handleUpload() {
    setUploadError(null);
    const effectiveTitle = title.trim() ||
      (file ? file.name.replace(/\.[^.]+$/, "") : urlInput.trim()) ||
      "Untitled";

    const form = new FormData();
    form.set("source_type", sourceType);
    form.set("title", effectiveTitle);
    form.set("default_tags", "[]");

    if (sourceType === "url") {
      if (!urlInput.trim()) { setUploadError("Enter a URL."); return; }
      form.set("url", urlInput.trim());
    } else if (sourceType === "article") {
      if (!articleText.trim()) { setUploadError("Enter some text."); return; }
      form.set("article_text", articleText.trim());
    } else {
      if (!file) { setUploadError("Select a file."); return; }
      form.set("file", file);
    }

    setUploading(true);
    try {
      const r = await fetch("/api/knowledge/ingest", { method: "POST", body: form });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status}: ${t}`);
      }
      const { doc_id } = await r.json();
      // Optimistically add a processing row
      setDocs((prev) => [{
        id: doc_id,
        title: effectiveTitle,
        source_type: sourceType,
        source_url: sourceType === "url" ? urlInput.trim() : null,
        default_tags: [],
        status: "processing",
        chunk_count: 0,
        error_detail: null,
        progress_stage: "queued",
        progress_done: 0,
        progress_total: 0,
        created_at: new Date().toISOString(),
      }, ...prev]);
      // Reset form
      setTitle(""); setUrlInput(""); setArticleText(""); setFile(null);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: string) {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDelId(null);
    const prev = docs;
    setDocs((p) => p.filter((d) => d.id !== id));
    try {
      const r = await fetch(`/api/knowledge/docs/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
    } catch (e) {
      console.error("[knowledge] delete failed:", e);
      setDocs(prev);
      alert(`Failed to delete: ${(e as Error).message}`);
    }
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    setFile(f);
    setSourceType(fileExtToSourceType(f.name));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setSourceType(fileExtToSourceType(f.name));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }

  const SOURCE_TYPES: SourceType[] = ["pdf", "docx", "pptx", "url", "article"];

  const inputStyle = {
    background: "rgba(0,0,0,0.25)",
    border: `1px solid ${T.border}`,
    borderRadius: 8,
    padding: "8px 12px",
    color: T.text,
    fontSize: 13,
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
    fontFamily: T.font.sans,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "24px 28px" }}>
      <style>{`@keyframes kb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{t("kb.title")}</div>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>
          {t("kb.subtitle")}
        </div>
      </div>

      {/* ── Top row: upload (left) + knowledge distribution (right) ───────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 20, alignItems: "stretch" }}>
      {/* ── Upload panel ─────────────────────────────────────────────────── */}
      <div className="glass" style={{ borderRadius: T.radius.card, padding: 22, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Source type tabs */}
        <div style={{ display: "flex", gap: 6 }}>
          {SOURCE_TYPES.map((s) => {
            const b = SOURCE_BADGE[s];
            const active = sourceType === s;
            return (
              <button
                key={s}
                onClick={() => setSourceType(s)}
                style={{
                  fontSize: 11, fontWeight: 600, padding: "4px 12px", borderRadius: 99,
                  border: `1px solid ${active ? b.color + "80" : T.border}`,
                  background: active ? b.bg : "transparent",
                  color: active ? b.color : T.muted,
                  cursor: "pointer", letterSpacing: "0.05em", textTransform: "uppercase",
                }}
              >
                {b.label}
              </button>
            );
          })}
        </div>

        {/* Input area */}
        {sourceType === "url" && (
          <input
            type="url"
            placeholder={t("kb.urlPlaceholder")}
            value={urlInput}
            onChange={(e) => {
              setUrlInput(e.target.value);
              if (!title && e.target.value) setTitle(new URL(e.target.value).hostname.replace("www.", ""));
            }}
            style={inputStyle}
          />
        )}
        {sourceType === "article" && (
          <textarea
            placeholder={t("kb.articlePlaceholder")}
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            rows={5}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        )}
        {(sourceType === "pdf" || sourceType === "docx" || sourceType === "pptx") && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
              border: `2px dashed ${dragOver ? SOURCE_BADGE[sourceType].color + "80" : T.border}`,
              borderRadius: 12, padding: "28px 20px", textAlign: "center",
              cursor: "pointer", transition: "border-color 0.15s",
              background: dragOver ? "rgba(255,252,245,0.03)" : "transparent",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={sourceType === "pdf" ? ".pdf" : sourceType === "docx" ? ".docx,.doc" : ".pptx,.ppt"}
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
            {file ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: SOURCE_BADGE[sourceType].color }}>{file.name}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    setTitle("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  title="Remove file"
                  style={{
                    background: "transparent",
                    border: `1px solid ${T.border}`,
                    color: T.muted,
                    cursor: "pointer",
                    fontSize: 11, lineHeight: 1,
                    width: 20, height: 20, borderRadius: "50%",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    padding: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; e.currentTarget.style.borderColor = "#f87171"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = T.muted; e.currentTarget.style.borderColor = T.border; }}
                >
                  ✕
                </button>
              </span>
            ) : (
              <span style={{ fontSize: 13, color: T.muted }}>
                {t("kb.dropPre")} {SOURCE_BADGE[sourceType].label} {t("kb.dropFile")}{" "}
                <span style={{ color: T.accent, textDecoration: "underline" }}>{t("kb.browse")}</span>
              </span>
            )}
          </div>
        )}

        {/* Title + upload row */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ fontSize: 10, color: T.muted, marginBottom: 4, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {t("kb.titleLabel")}
            </div>
            <input
              type="text"
              placeholder={t("kb.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={inputStyle}
            />
            <div style={{ fontSize: 10, color: T.border, marginTop: 4 }}>
              {t("kb.autoTagHint")}
            </div>
          </div>

          <button
            onClick={handleUpload}
            disabled={uploading}
            style={{
              fontSize: 12, padding: "8px 18px", borderRadius: 99,
              background: "linear-gradient(135deg, rgba(98,132,88,0.95) 0%, rgba(58,82,52,0.95) 100%)",
              border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6",
              fontWeight: 600, cursor: uploading ? "not-allowed" : "pointer",
              opacity: uploading ? 0.7 : 1, flexShrink: 0,
              boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 4px 14px rgba(58,82,52,0.45)",
            }}
          >
            {uploading ? <Spinner emoji="⚙️" label={t("kb.analysing")} /> : t("kb.upload")}
          </button>
        </div>

        {uploadError && (
          <div style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>{uploadError}</div>
        )}
      </div>

      {/* Knowledge distribution */}
      {agentMem
        ? <KnowledgeDistribution agentMem={agentMem} />
        : (
          <div className="glass" style={{ borderRadius: T.radius.card, padding: 20, display: "flex", alignItems: "center", justifyContent: "center", color: T.muted, fontSize: 12 }}>
            {agentMemState === "error"
              ? <span style={{ color: "#f87171" }}>{t("kb.memoryFailed")}</span>
              : <Spinner emoji="🧠" label={t("kb.memoryLoading")} />}
          </div>
        )}
      </div>

      {/* ── Documents list ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.mutedMid, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {t("kb.documents")} {docs.length > 0 && `· ${docs.length}`}
        </div>

        {loadingDocs && (
          <div style={{ fontSize: 13, color: T.muted }}>
            <Spinner emoji="⚙️" label={t("kb.loading")} />
          </div>
        )}

        {docsError && (
          <div style={{
            fontSize: 11, color: "#f87171", fontFamily: T.font.mono,
            padding: "8px 12px", borderRadius: 8,
            background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.4)",
          }}>
            Couldn’t load documents from the server — list may be out of date. ({docsError})
          </div>
        )}

        {!loadingDocs && docs.length === 0 && (
          <div className="glass" style={{ borderRadius: T.radius.card, padding: "32px 24px", textAlign: "center", color: T.muted, fontSize: 13 }}>
            {t("kb.emptyDocs")}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 8 }}>
        {docs.map((doc) => {
          const badge = SOURCE_BADGE[doc.source_type];
          return (
            <div
              key={doc.id}
              className="glass"
              style={{ borderRadius: T.radius.md, overflow: "hidden" }}
            >
              <div style={{
                padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              }}>
                {/* Expand/collapse chunk tree — only ready docs have chunks to show */}
                {doc.status === "ready" && doc.chunk_count > 0 ? (
                  <button
                    onClick={() => toggleDoc(doc.id)}
                    title={openDocs[doc.id] ? t("kb.collapseChunks") : t("kb.expandChunks")}
                    style={{
                      flexShrink: 0, background: "transparent", border: "none",
                      color: openDocs[doc.id] ? T.text : T.muted, cursor: "pointer",
                      fontSize: 11, lineHeight: 1, padding: 2, width: 16,
                      transform: openDocs[doc.id] ? "rotate(90deg)" : "none",
                      transition: "transform 0.15s, color 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = T.text; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = openDocs[doc.id] ? T.text : T.muted; }}
                  >
                    ▶
                  </button>
                ) : (
                  <span style={{ flexShrink: 0, width: 16 }} />
                )}

                {/* Source badge */}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                  background: badge.bg, color: badge.color,
                  letterSpacing: "0.06em", flexShrink: 0,
                }}>
                  {badge.label}
                </span>

                {/* Title */}
                <span style={{ flex: "1 1 160px", fontSize: 13, color: T.text, fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {doc.title}
                </span>

                {/* Status / chunk count */}
                <span style={{ fontSize: 11, color: T.muted, flexShrink: 0, minWidth: 80 }}>
                  {doc.status === "processing" && (
                    <Spinner emoji="⚙️" label={stageLabel(doc.progress_stage, doc.progress_done, doc.progress_total, t)} />
                  )}
                  {doc.status === "ready" && `${doc.chunk_count} ${doc.chunk_count !== 1 ? t("kb.chunks") : t("kb.chunk")}`}
                  {doc.status === "error" && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); alert(doc.error_detail ?? "Unknown error"); }}
                      title={doc.error_detail ?? "Unknown error"}
                      style={{
                        background: "transparent", border: "none", padding: 0,
                        color: "#f87171", cursor: "pointer", fontSize: 11,
                        textDecoration: "underline dotted", textUnderlineOffset: 3,
                      }}
                    >
                      {t("kb.error")}
                    </button>
                  )}
                </span>

                {/* Delete — two-click confirm */}
                {confirmDelId === doc.id ? (
                  <button
                    onClick={() => handleDelete(doc.id)}
                    title="Click to confirm deletion"
                    style={{
                      flexShrink: 0,
                      background: "rgba(248,113,113,0.15)",
                      border: "1px solid rgba(248,113,113,0.55)",
                      color: "#f87171",
                      cursor: "pointer", fontSize: 10, fontWeight: 700,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                      padding: "3px 9px", borderRadius: 99,
                    }}
                  >
                    {t("kb.confirmDelete")}
                  </button>
                ) : (
                  <button
                    onClick={() => armDelete(doc.id)}
                    title="Delete document"
                    style={{
                      flexShrink: 0, background: "transparent", border: "none",
                      color: T.muted, cursor: "pointer", fontSize: 14, lineHeight: 1,
                      padding: "2px 4px", borderRadius: 4,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = T.muted; }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Collapsible chunk tree */}
              {doc.status === "ready" && doc.chunk_count > 0 && openDocs[doc.id] && (
                <DocChunkTree docId={doc.id} title={doc.title} />
              )}
            </div>
          );
        })}
        </div>
      </div>

      {/* ── Agent knowledge (per-agent RAG memory) ───────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: T.mutedMid, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {t("kb.agentMemory")}
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 3 }}>
            {t("kb.agentMemorySub")}
          </div>
        </div>

        {agentMemState === "loading" && agentMem === null && (
          <div style={{ fontSize: 12, color: T.muted }}>
            <Spinner emoji="🧠" label={t("kb.memoryLoading")} />
          </div>
        )}
        {agentMemState === "error" && agentMem === null && (
          <div style={{ fontSize: 11, color: "#f87171" }}>{t("kb.memoryFailed")}</div>
        )}
        {agentMem && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
            {AGENTS.map((a) => (
              <AgentMemoryCard
                key={a}
                agent={a}
                mem={agentMem[a] ?? { chunk_count: 0, docs: [] }}
                onRefresh={() => handleRefreshAgent(a)}
                refreshing={refreshingAgent === a}
              />
            ))}
          </div>
        )}
        {unassignedMem && unassignedMem.chunk_count > 0 && (
          <UnassignedMemoryCard
            mem={unassignedMem}
            onAssign={handleAssignChunk}
            onDelete={handleDeleteChunk}
          />
        )}
      </div>
    </div>
  );
}
