"use client";

import { useState } from "react";

// Strava brand guideline: any UI that displays Strava data must show
// "Powered by Strava" attribution. Renders the official horizontal white
// wordmark from /public/strava/, falling back to a styled text approximation
// if the asset is missing (see /web/public/strava/README.md).
type Props = {
  height?: number;
  align?: "left" | "right" | "center";
  testId?: string;
};

export default function PoweredByStrava({
  height = 14,
  align = "right",
  testId = "powered-by-strava",
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);

  const justify =
    align === "left" ? "flex-start"
    : align === "right" ? "flex-end"
    : "center";

  return (
    <div
      data-testid={testId}
      style={{
        display: "flex",
        justifyContent: justify,
        alignItems: "center",
        opacity: 0.7,
        marginTop: 6,
        lineHeight: 0,
      }}
    >
      {imgFailed ? (
        <FallbackWordmark height={height} />
      ) : (
        <img
          src="/strava/api_logo_pwrdBy_strava_horiz_orange.png"
          alt="Powered by Strava"
          onError={() => setImgFailed(true)}
          style={{ height, width: "auto", display: "block" }}
        />
      )}
    </div>
  );
}

function FallbackWordmark({ height }: { height: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: Math.round(height * 0.7),
        color: "rgba(255,255,255,0.75)",
        letterSpacing: 0.6,
      }}
    >
      <span style={{ textTransform: "uppercase" }}>Powered by</span>
      <span style={{ fontWeight: 800, fontStyle: "italic", letterSpacing: 1, color: "#FC4C02" }}>
        STRAVA
      </span>
    </span>
  );
}
