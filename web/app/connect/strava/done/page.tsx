import { T } from "@/lib/design-tokens";

export default function StravaDonePage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        className="glass glass-tint-moss"
        data-testid="strava-public-done"
        style={{ borderRadius: T.radius.card, padding: 32, maxWidth: 440, textAlign: "center" }}
      >
        <div style={{ fontFamily: T.font.mono, fontSize: 26, marginBottom: 8 }}>You're connected ✓</div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
          Your full Strava history has been pulled into gymDays — your coach can see every activity. New workouts will sync automatically going forward. You can close this tab.
        </div>
      </div>
    </div>
  );
}
