import { T } from "@/lib/design-tokens";

export type Flag = {
  kind: string;
  severity: "low" | "medium" | "high";
  rationale: string;
  raised_at?: string;
};

const SEV_COLOR: Record<Flag["severity"], string> = {
  low:    "#fbbf24",
  medium: "#f97316",
  high:   "#ef4444",
};

export default function FlagChips({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {flags.map((f, i) => (
        <div
          key={i}
          title={f.rationale}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: SEV_COLOR[f.severity] + "18",
            border: `1px solid ${SEV_COLOR[f.severity]}44`,
            borderRadius: T.radius.pill,
            padding: "3px 10px",
            cursor: "default",
          }}
        >
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: SEV_COLOR[f.severity], flexShrink: 0,
          }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: SEV_COLOR[f.severity] }}>
            {f.kind}
          </span>
          <span style={{ fontSize: 10, color: T.muted }}>{f.severity}</span>
        </div>
      ))}
    </div>
  );
}
