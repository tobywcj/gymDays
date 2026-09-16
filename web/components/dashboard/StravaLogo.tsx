import { T } from "@/lib/design-tokens";

export default function StravaLogo({ size = 26 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "#FC4C02",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <span style={{ fontFamily: T.font.mono, fontSize: size * 0.5, color: "#fff", lineHeight: 1 }}>S</span>
    </div>
  );
}
