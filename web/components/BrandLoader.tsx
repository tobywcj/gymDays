"use client";

import { T } from "@/lib/design-tokens";
import BatMark from "@/components/BatMark";

// Animated version of the Gym Days app logo (the pixel bat mark from the
// sidebar, wings flapping). Used as the route-level loading indicator so
// navigating via the sidebar (dashboard) or the topbar (client portal) shows
// a branded, lively fallback instead of a generic spinner.
export default function BrandLoader({ label, size = 104 }: { label?: string; size?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <style>{`
        @keyframes brand-breathe-soft {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.08); }
        }
        @keyframes brand-ring {
          0%   { transform: scale(0.9); opacity: 0.55; }
          70%  { transform: scale(1.7); opacity: 0; }
          100% { transform: scale(1.7); opacity: 0; }
        }
        @keyframes brand-letter {
          0%, 100% { opacity: 0.92; transform: translateY(0); }
          50%      { opacity: 1; transform: translateY(-1px); }
        }
        @keyframes brand-label {
          0%, 100% { opacity: 0.45; }
          50%      { opacity: 0.85; }
        }
        @media (prefers-reduced-motion: reduce) {
          .brand-loader-tile, .brand-loader-shimmer, .brand-loader-ring,
          .brand-loader-letter, .brand-loader-label { animation: none !important; }
        }
      `}</style>

      <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {/* Pulsing glow ring */}
        <div
          className="brand-loader-ring"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: size * 0.28,
            border: "1px solid rgba(196,148,82,0.6)",
            animation: "brand-ring 1.8s ease-out infinite",
          }}
        />
        {/* Transparent breathing mark — flapping bat, no tile */}
        <div
          className="brand-loader-tile"
          style={{
            position: "relative",
            width: size,
            height: size,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            animation: "brand-breathe-soft 1.8s ease-in-out infinite",
          }}
        >
          <BatMark size={size * 0.92} flapping speed={0.45} />
        </div>
      </div>

      {label && (
        <span
          className="brand-loader-label"
          style={{
            fontFamily: T.font.sans,
            fontSize: 12.5,
            letterSpacing: "0.02em",
            color: "#e4c08c",
            animation: "brand-label 1.8s ease-in-out infinite",
          }}
        >
          {label}
        </span>
      )}
    </div>
  );
}
