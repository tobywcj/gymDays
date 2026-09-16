import { T } from "@/lib/design-tokens";

type Props = {
  sessions: string;  // e.g. "4" or "4/5"
  load: string;      // e.g. "↑ +12%" or "—"
  loadUp?: boolean;
  flagCount: number;
};

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
        textTransform: "uppercase", color: T.muted,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 16, fontWeight: 700,
        fontFamily: T.font.mono,
        color: color ?? T.text,
      }}>
        {value}
      </span>
    </div>
  );
}

export default function PulseStrip({ sessions, load, loadUp, flagCount }: Props) {
  const flagColor = flagCount === 0 ? "#4ade80" : flagCount === 1 ? "#fbbf24" : "#ef4444";
  const loadColor = loadUp === true ? "#4ade80" : loadUp === false ? "#f87171" : T.mutedMid;

  return (
    <div style={{
      display: "flex", gap: 20, alignItems: "center",
      padding: "10px 14px",
      background: "rgba(0,0,0,0.18)",
      borderRadius: 10,
      flexWrap: "wrap",
    }}>
      <Stat label="Sessions" value={sessions} />
      <div style={{ width: 1, height: 30, background: T.border, flexShrink: 0 }} />
      <Stat label="Load" value={load} color={loadColor} />
      <div style={{ width: 1, height: 30, background: T.border, flexShrink: 0 }} />
      <Stat label="Flags" value={flagCount === 0 ? "None" : String(flagCount)} color={flagColor} />
    </div>
  );
}
