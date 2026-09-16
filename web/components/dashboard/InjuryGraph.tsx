"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

// Single-branch injury timeline: one node per trail entry (oldest → newest),
// connected in a line, with the entry's date under each node. Each node's colour
// reflects that entry's state: ACTIVE (red — the current/latest open injury),
// PAST (amber — an earlier open entry, still flags), or RESOLVED (grey — closed).

type Entry = { note: string | null; resolved: boolean; created_at: string };
type Props = { official: string | null; entries: Entry[] };
type NodeState = "active" | "past" | "resolved";

const AREAS: { en: string; zh: string; kw: string[] }[] = [
  { en: "Shoulder", zh: "肩", kw: ["shoulder", "rotator", "肩", "膊"] },
  { en: "Knee", zh: "膝", kw: ["knee", "acl", "mcl", "menisc", "膝"] },
  { en: "Back", zh: "腰背", kw: ["back", "lumbar", "spine", "disc", "腰", "背", "脊"] },
  { en: "Hip", zh: "髖", kw: ["hip", "groin", "髖"] },
  { en: "Elbow", zh: "肘", kw: ["elbow", "tennis", "golfer", "肘"] },
  { en: "Wrist", zh: "腕", kw: ["wrist", "carpal", "腕"] },
  { en: "Neck", zh: "頸", kw: ["neck", "cervical", "頸"] },
  { en: "Ankle", zh: "踝", kw: ["ankle", "achilles", "踝"] },
];

const STATE_STYLE: Record<NodeState, { fill: string; stroke: string }> = {
  active:   { fill: "rgba(196,76,60,0.30)",  stroke: "#e0796a" },
  past:     { fill: "rgba(196,148,82,0.22)", stroke: "#e4c08c" },
  resolved: { fill: "rgba(160,160,160,0.16)", stroke: "#9aa0a0" },
};

export default function InjuryGraph({ official, entries }: Props) {
  const { t, locale } = useI18n();

  const usable = entries.filter((e) => (e.note ?? "").trim());
  if (usable.length === 0) return null;

  // Oldest → newest along the branch.
  const sorted = [...usable].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latestActive = sorted.filter((e) => !e.resolved).map((e) => e.created_at).sort().at(-1) ?? null;

  const areaLabel = (note: string): string => {
    const low = note.toLowerCase();
    const hit = AREAS.find((a) => a.kw.some((k) => low.includes(k)));
    if (hit) return locale === "zh" ? hit.zh : hit.en;
    const trimmed = note.trim();
    return trimmed.length > 12 ? trimmed.slice(0, 11) + "…" : trimmed;
  };
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "zh" ? "zh-TW" : "en-US", { month: "short", day: "numeric" });

  const nodes = sorted.map((e) => ({
    label: areaLabel(e.note ?? ""),
    date: dateLabel(e.created_at),
    state: (e.resolved ? "resolved" : (e.created_at === latestActive ? "active" : "past")) as NodeState,
  }));

  // Horizontal layout; the wrapper scrolls when there are many nodes.
  const step = 92, padX = 16, nodeY = 26, w = 76, h = 26;
  const svgW = Math.max(240, padX * 2 + (nodes.length - 1) * step + w);
  const svgH = 74;
  const x = (i: number) => padX + w / 2 + i * step;

  return (
    <div data-testid="injury-graph" style={{ background: "rgba(0,0,0,0.18)", borderRadius: 12, padding: "8px 4px" }}>
      <div style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 ${svgW} ${svgH}`} width={svgW} style={{ display: "block", maxWidth: "none" }}>
          {/* single branch line */}
          {nodes.length > 1 && (
            <line x1={x(0)} y1={nodeY} x2={x(nodes.length - 1)} y2={nodeY} stroke={T.border} strokeWidth={1.5} />
          )}
          {nodes.map((n, i) => {
            const s = STATE_STYLE[n.state];
            return (
              <g key={i} opacity={n.state === "resolved" ? 0.7 : 1}>
                <rect x={x(i) - w / 2} y={nodeY - h / 2} width={w} height={h} rx={13}
                  fill={s.fill} stroke={s.stroke} strokeWidth={1.3}
                  strokeDasharray={n.state === "resolved" ? "3 3" : undefined} />
                <text x={x(i)} y={nodeY + 4} textAnchor="middle" fontSize={11} fontWeight={600} fill={T.text}
                  style={{ textDecoration: n.state === "resolved" ? "line-through" : "none" }}>{n.label}</text>
                <text x={x(i)} y={nodeY + h / 2 + 14} textAnchor="middle" fontSize={9} fill={T.muted}>{n.date}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", fontSize: 10, color: T.muted, marginTop: 2, flexWrap: "wrap" }}>
        <span><span style={{ color: STATE_STYLE.active.stroke }}>●</span> {t("injury.active")}</span>
        <span><span style={{ color: STATE_STYLE.past.stroke }}>●</span> {t("injury.past")}</span>
        <span><span style={{ color: STATE_STYLE.resolved.stroke }}>●</span> {t("injury.resolvedTag")}</span>
      </div>
    </div>
  );
}
