"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";
import type { ExerciseRow } from "@/lib/exercise-library";

// Gym demonstration photo (free-exercise-db, resolved server-side into
// ex.imageUrl / ex.imageUrlAlt). When two frames exist they auto-alternate to
// mimic the movement, like an exercise GIF. Renders nothing when there's no
// photo or the image 404s — it lives inside a collapsible, so the card's
// primary visual (muscle map / illustration) is unaffected.

type Props = {
  ex: Pick<ExerciseRow, "imageUrl" | "imageUrlAlt">;
  size?: number;
};

export default function ExerciseVisual({ ex, size = 160 }: Props) {
  const [broken, setBroken] = useState(false);
  if (!ex.imageUrl || broken) return null;

  const twoFrame = !!ex.imageUrlAlt;

  return (
    <div
      style={{
        width: size, height: size, position: "relative", borderRadius: 12,
        overflow: "hidden", background: "#f4f4f2", flexShrink: 0,
      }}
    >
      {twoFrame && (
        <style>{`@keyframes ex-frameSwap { 0%,45% { opacity: 0 } 55%,100% { opacity: 1 } }`}</style>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ex.imageUrl}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
      />
      {twoFrame && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ex.imageUrlAlt!}
          alt=""
          loading="lazy"
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain",
            animation: "ex-frameSwap 1.6s ease-in-out infinite",
          }}
        />
      )}
      <div style={{ position: "absolute", inset: 0, borderRadius: 12, boxShadow: `inset 0 0 0 1px ${T.border}`, pointerEvents: "none" }} />
    </div>
  );
}
