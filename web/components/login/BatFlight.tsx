"use client";

import { useEffect, useRef, useState } from "react";
import BatMark from "@/components/BatMark";

// Flappy-Bird-style sign-in transition. When `active` flips true a big bat flies
// across the screen, threading the gaps of a row of FIXED sketched tunnels (the
// tunnels never move — the bat does), then the screen fades to deep space and
// `onComplete` fires so the app can load. Plays on a successful password sign-in
// (see app/login/page.tsx).

const DURATION = 3000;   // ms for the bat to cross the screen
const FADE = 480;        // ms fade-to-space at the end
const BAT = 168;         // bat size (much bigger)
const TW = 92;           // tunnel width
const INK = "rgba(226, 231, 239, 0.72)";
const INK_DIM = "rgba(226, 231, 239, 0.34)";

type Tunnel = { x: number; gapY: number; gapH: number };

export default function BatFlight({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete: () => void;
}) {
  const [scene, setScene] = useState<{ w: number; h: number; tunnels: Tunnel[] } | null>(null);
  const batRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);

  // Build the fixed tunnels once the flight starts.
  useEffect(() => {
    if (!active) { setScene(null); return; }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const gapH = Math.max(230, Math.min(h * 0.42, 380));
    const n = 5;
    const tunnels: Tunnel[] = [];
    for (let i = 0; i < n; i++) {
      const x = w * (0.24 + (i / (n - 1)) * 0.62) - TW / 2;
      const gapY = h * 0.3 + Math.random() * h * 0.4;
      tunnels.push({ x, gapY, gapH });
    }
    setScene({ w, h, tunnels });
  }, [active]);

  // Fly the bat through the fixed tunnels.
  useEffect(() => {
    if (!scene) return;
    const bat = batRef.current;
    const fade = fadeRef.current;
    if (!bat || !fade) return;

    const { w, h, tunnels } = scene;
    let raf = 0;
    let start = 0;
    let batY = tunnels[0]?.gapY ?? h / 2;
    let lastY = batY;
    let finished = false;

    const step = (ts: number) => {
      if (!start) start = ts;
      const t = ts - start;
      const p = Math.min(1, t / DURATION);
      const batX = -BAT + (w + BAT * 2) * p;

      // Aim for the gap of the next tunnel ahead of the bat.
      let target = batY;
      let best = Infinity;
      for (const tn of tunnels) {
        const c = tn.x + TW / 2;
        if (c >= batX - BAT * 0.15) {
          const d = c - batX;
          if (d < best) { best = d; target = tn.gapY; }
        }
      }
      const bob = Math.sin(t / 200) * 8;
      batY += (target + bob - batY) * 0.1;
      const tilt = Math.max(-24, Math.min(30, (batY - lastY) * 2.4));
      lastY = batY;
      bat.style.transform = `translate(${batX}px, ${batY}px) translate(-50%, -50%) rotate(${tilt}deg)`;

      if (t > DURATION - FADE) fade.style.opacity = String(Math.min(1, (t - (DURATION - FADE)) / FADE));
      if (t >= DURATION) { if (!finished) { finished = true; onComplete(); } return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scene, onComplete]);

  if (!active || !scene) {
    // Keep the overlay mounted (dark) the instant we activate, before measuring.
    return active ? <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#07080a" }} /> : null;
  }

  const { w, h, tunnels } = scene;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        overflow: "hidden",
        background: "radial-gradient(130% 100% at 50% 40%, #1b1e25 0%, #111317 55%, #07080a 100%)",
      }}
    >
      {/* Fixed sketched tunnels */}
      <svg
        width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: "absolute", inset: 0 }}
        fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
      >
        {tunnels.map((tn, i) => {
          const top = tn.gapY - tn.gapH / 2;
          const bot = tn.gapY + tn.gapH / 2;
          const hatch: string[] = [];
          for (let y = 22; y < top - 14; y += 26) hatch.push(`M${tn.x + 10} ${y} L${tn.x + TW - 10} ${y}`);
          for (let y = bot + 22; y < h - 8; y += 26) hatch.push(`M${tn.x + 10} ${y} L${tn.x + TW - 10} ${y}`);
          return (
            <g key={i}>
              <path d={`M${tn.x} 0 L${tn.x} ${top} M${tn.x + TW} 0 L${tn.x + TW} ${top}`} />
              <rect x={tn.x - 7} y={top - 13} width={TW + 14} height={13} rx={6} />
              <path d={`M${tn.x} ${bot} L${tn.x} ${h} M${tn.x + TW} ${bot} L${tn.x + TW} ${h}`} />
              <rect x={tn.x - 7} y={bot} width={TW + 14} height={13} rx={6} />
              <path d={hatch.join(" ")} stroke={INK_DIM} strokeWidth={1.3} />
            </g>
          );
        })}
      </svg>

      {/* The bat */}
      <div
        ref={batRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          color: "#ffffff",
          filter: "drop-shadow(0 0 22px rgba(196,148,82,0.6))",
          willChange: "transform",
        }}
      >
        <BatMark size={BAT} flapping speed={0.14} />
      </div>

      <div ref={fadeRef} style={{ position: "absolute", inset: 0, background: "#07080a", opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}
