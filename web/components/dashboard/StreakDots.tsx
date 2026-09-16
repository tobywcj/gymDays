type Props = {
  days?: number;
  filled?: number;
};

export default function StreakDots({ days = 14, filled = 10 }: Props) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 4 }}>
      {Array.from({ length: days }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: i < filled ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.15)",
            boxShadow: i < filled ? "0 0 6px rgba(255,255,255,0.5)" : "none",
            transition: "all 0.2s",
          }}
        />
      ))}
    </div>
  );
}
