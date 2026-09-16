"use client";

import { useState } from "react";

// Renders Strava's official "Connect with Strava" orange button.
// Falls back to a styled approximation if the official asset has not yet been
// dropped into /public/strava/ (see /web/public/strava/README.md).
type Props = {
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  testId?: string;
  height?: number;
};

export default function ConnectWithStravaButton({
  onClick,
  disabled,
  busy,
  testId = "connect-with-strava",
  height = 48,
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const useFallback = imgFailed;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      data-testid={testId}
      style={{
        all: "unset",
        cursor: disabled || busy ? "not-allowed" : "pointer",
        opacity: disabled || busy ? 0.7 : 1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
      }}
      aria-label="Connect with Strava"
    >
      {useFallback ? (
        <FallbackButton height={height} busy={busy} />
      ) : (
        // Strava's official PNG. The 2x asset is ~1100×196 native; we render
        // at the requested height keeping the aspect ratio intact.
        <img
          src="/strava/btn_strava_connect_with_orange_x2.png"
          alt="Connect with Strava"
          onError={() => setImgFailed(true)}
          style={{ height, width: "auto", display: "block" }}
        />
      )}
    </button>
  );
}

function FallbackButton({ height, busy }: { height: number; busy?: boolean }) {
  const innerHeight = height;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: innerHeight,
        padding: `0 ${Math.round(innerHeight * 0.45)}px`,
        background: "#FC4C02",
        color: "#ffffff",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 700,
        fontSize: Math.round(innerHeight * 0.32),
        borderRadius: 6,
        letterSpacing: 0.2,
      }}
    >
      <span style={{ fontWeight: 500, opacity: 0.95 }}>
        {busy ? "⏳ Connecting…" : "Connect with"}
      </span>
      <span style={{ fontWeight: 800, fontStyle: "italic", letterSpacing: 1 }}>
        STRAVA
      </span>
    </span>
  );
}
