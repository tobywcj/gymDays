import type { CSSProperties, ReactNode } from "react";
import { T, type Tint } from "@/lib/design-tokens";
import DotNumber from "./DotNumber";

type Props = {
  tint?: Tint;
  number?: string | number;
  label?: string;
  sub?: string;
  /** Optional test id forwarded to the sub line. */
  subTestId?: string;
  /** Small glyph rendered in a chip at the top-right of the card. */
  icon?: ReactNode;
  /** Rendered directly under the number (e.g. streak dots). */
  accessory?: ReactNode;
  /** Rendered in the bottom-right of the card (e.g. an avatar stack of affected clients). */
  graphic?: ReactNode;
  /** Override the accent colour used for the icon + status dot. */
  accent?: string;
  /** When true the card reads as "needs attention": pulsing icon + warm sub dot. */
  alert?: boolean;
  style?: CSSProperties;
};

const ACCENT: Record<Tint, string> = {
  terracotta: "#e89878",
  moss: "#b0d4a0",
  ochre: "#e4c08c",
  sage: "#bcd3b8",
};

export default function MetricCard({ tint, number, label, sub, subTestId, icon, accessory, graphic, accent, alert, style }: Props) {
  const tintClass = tint ? `glass-tint-${tint}` : "";
  const glow = accent ?? (tint ? ACCENT[tint] : T.accent);
  return (
    <div
      className={`glass ${tintClass}`.trim()}
      style={{
        borderRadius: T.radius.card,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        color: T.text,
        minHeight: 138,
        ...style,
      }}
    >
      {/* Header — label on the left, an accent icon chip on the right */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {label && (
          <span
            style={{
              fontFamily: T.font.sans,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(244,237,226,0.6)",
            }}
          >
            {label}
          </span>
        )}
        {icon && (
          <span
            className={alert ? "alert-pulse" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 9,
              background: alert ? `${glow}22` : "rgba(255,252,245,0.07)",
              border: `1px solid ${alert ? `${glow}66` : "rgba(255,252,245,0.12)"}`,
              color: glow,
              flexShrink: 0,
              ...(alert ? ({ ["--pulse-color" as string]: `${glow}55` } as CSSProperties) : {}),
            }}
          >
            {icon}
          </span>
        )}
      </div>

      {/* Value — pushed to the bottom so every card shares the same baseline.
          The number/sub sit on the left; the graphic (e.g. affected clients) on the right. */}
      <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          {number !== undefined && <DotNumber value={number} size={46} color="rgba(255, 252, 245, 0.97)" />}
          {accessory}
          {sub && (
            <span
              data-testid={subTestId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: T.font.sans,
                fontSize: 11,
                color: "rgba(244,237,226,0.52)",
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: glow,
                  boxShadow: `0 0 6px ${glow}`,
                  flexShrink: 0,
                }}
              />
              {sub}
            </span>
          )}
        </div>
        {graphic && <div style={{ flexShrink: 0, paddingBottom: 2 }}>{graphic}</div>}
      </div>
    </div>
  );
}
