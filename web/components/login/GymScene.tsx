"use client";

import { useEffect, useRef } from "react";

// Interactive "walk through the gym" backdrop for the login page. A long
// hand-drawn ground line carries sketched gym machines (treadmill, bike, rower,
// bench, squat rack, dumbbell rack, kettlebells, stair climber). A stickman
// stands on the ground; press ← / → (or A / D) to walk him left and right and
// the world scrolls past — a little side-scroller behind the sign-in card.
//
// Keyboard is ignored while a text field is focused, so typing the email /
// password never moves the stickman. Decorative: the layer is pointer-transparent
// so the card stays clickable.

const INK = "rgba(226, 231, 239, 0.72)";
const INK_DIM = "rgba(226, 231, 239, 0.4)";
const SCENE_H = 560;
const GROUND = 470;          // y of the ground line within the scene svg
const SPEED = 4.2;           // px per frame while walking

// ── Equipment sketches (drawn with bottoms sitting on y = 0 = the ground) ──
const EQUIP: { x: number; el: React.ReactNode }[] = [
  {
    x: 150,
    el: (
      <g>
        <path d="M0 0 L4 -16 L150 -30 L150 -12 Z" />
        <line x1="10" y1="-15" x2="146" y2="-28" />
        <circle cx="9" cy="-6" r="6" />
        <line x1="140" y1="-28" x2="150" y2="-112" />
        <line x1="128" y1="-26" x2="138" y2="-112" />
        <line x1="138" y1="-100" x2="172" y2="-95" />
        <rect x="130" y="-146" width="48" height="32" rx="3" />
        <line x1="138" y1="-112" x2="146" y2="-146" />
        <line x1="170" y1="-112" x2="162" y2="-146" />
        <line x1="-2" y1="0" x2="0" y2="-10" />
      </g>
    ),
  },
  {
    x: 470,
    el: (
      <g>
        <line x1="-6" y1="0" x2="52" y2="0" />
        <circle cx="20" cy="-24" r="22" />
        <circle cx="20" cy="-24" r="4" />
        <line x1="20" y1="-24" x2="58" y2="-84" />
        <line x1="20" y1="-24" x2="30" y2="-92" />
        <line x1="50" y1="-88" x2="72" y2="-86" />
        <line x1="30" y1="-92" x2="28" y2="-112" />
        <line x1="16" y1="-112" x2="42" y2="-112" />
        <line x1="20" y1="-24" x2="20" y2="-8" />
        <line x1="12" y1="-6" x2="28" y2="-6" />
      </g>
    ),
  },
  {
    x: 770,
    el: (
      <g>
        <line x1="0" y1="-12" x2="190" y2="-28" />
        <circle cx="16" cy="-28" r="17" />
        <circle cx="16" cy="-28" r="5" />
        <rect x="96" y="-34" width="24" height="7" rx="2" />
        <line x1="33" y1="-28" x2="86" y2="-24" />
        <line x1="33" y1="-33" x2="33" y2="-22" />
        <line x1="28" y1="-19" x2="44" y2="-10" />
        <line x1="6" y1="-22" x2="-4" y2="0" />
        <line x1="6" y1="-22" x2="16" y2="0" />
        <line x1="178" y1="-26" x2="186" y2="0" />
        <line x1="178" y1="-26" x2="170" y2="0" />
      </g>
    ),
  },
  {
    x: 1090,
    el: (
      <g>
        <rect x="20" y="-46" width="74" height="11" rx="3" />
        <g transform="rotate(-26 12 -66)">
          <rect x="-8" y="-72" width="36" height="10" rx="3" />
        </g>
        <line x1="28" y1="-35" x2="22" y2="0" />
        <line x1="86" y1="-35" x2="92" y2="0" />
        <line x1="14" y1="0" x2="30" y2="0" />
        <line x1="84" y1="0" x2="100" y2="0" />
      </g>
    ),
  },
  {
    x: 1380,
    el: (
      <g>
        <line x1="0" y1="0" x2="0" y2="-154" />
        <line x1="92" y1="0" x2="92" y2="-154" />
        <line x1="-14" y1="0" x2="14" y2="0" />
        <line x1="78" y1="0" x2="106" y2="0" />
        <line x1="0" y1="-154" x2="92" y2="-154" />
        <line x1="-22" y1="-122" x2="114" y2="-122" />
        <rect x="-14" y="-136" width="8" height="28" />
        <rect x="-24" y="-140" width="8" height="36" />
        <rect x="98" y="-136" width="8" height="28" />
        <rect x="108" y="-140" width="8" height="36" />
        <line x1="0" y1="-120" x2="-6" y2="-120" />
        <line x1="92" y1="-120" x2="98" y2="-120" />
      </g>
    ),
  },
  {
    x: 1680,
    el: (
      <g>
        <line x1="0" y1="0" x2="14" y2="-72" />
        <line x1="84" y1="0" x2="70" y2="-72" />
        <line x1="14" y1="-72" x2="70" y2="-72" />
        <line x1="-8" y1="0" x2="22" y2="0" />
        <line x1="62" y1="0" x2="92" y2="0" />
        <line x1="7" y1="-24" x2="77" y2="-24" />
        <line x1="11" y1="-48" x2="73" y2="-48" />
        {[
          [22, -10], [42, -10], [62, -10],
          [26, -34], [42, -34], [58, -34],
          [30, -58], [42, -58], [54, -58],
        ].map(([cx, cy], i) => (
          <g key={i}>
            <line x1={cx - 7} y1={cy} x2={cx + 7} y2={cy} />
            <circle cx={cx - 8} cy={cy} r="2.6" />
            <circle cx={cx + 8} cy={cy} r="2.6" />
          </g>
        ))}
      </g>
    ),
  },
  {
    x: 1950,
    el: (
      <g>
        {[
          [10, 1.0], [44, 0.78], [72, 0.62],
        ].map(([cx, s], i) => (
          <g key={i} transform={`translate(${cx} 0) scale(${s})`}>
            <path d="M-11 -34 a11 9 0 0 1 22 0" />
            <path d="M-8 -31 q-9 5 -9 18 a15 15 0 0 0 34 0 q0 -13 -9 -18" />
          </g>
        ))}
      </g>
    ),
  },
  {
    x: 2200,
    el: (
      <g>
        <line x1="0" y1="0" x2="130" y2="0" />
        <path d="M12 0 L104 0 L104 -96 Z" />
        <line x1="40" y1="-22" x2="62" y2="-22" />
        <line x1="52" y1="-44" x2="76" y2="-44" />
        <line x1="64" y1="-66" x2="90" y2="-66" />
        <line x1="104" y1="-96" x2="104" y2="-158" />
        <line x1="90" y1="-66" x2="90" y2="-158" />
        <rect x="84" y="-186" width="42" height="30" rx="3" />
        <line x1="90" y1="-158" x2="62" y2="-146" />
        <line x1="104" y1="-158" x2="120" y2="-150" />
      </g>
    ),
  },
];

const WORLD_W = 2400; // one tile of equipment; the world repeats this seamlessly

export default function GymScene() {
  const worldRef = useRef<HTMLDivElement>(null);
  const stickWrapRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<SVGGElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const world = worldRef.current;
    const wrap = stickWrapRef.current;
    const stick = stickRef.current;
    if (!world || !wrap || !stick) return;

    const keys = { left: false, right: false };
    let worldX = 0;
    let dir = 1;
    let raf = 0;
    let running = false;
    let movedOnce = false;

    const followX = () => window.innerWidth * 0.26;

    // Infinite world: wrap the camera by one tile so the equipment repeats
    // forever in both directions (three tiles are rendered, see below).
    const place = () => {
      const mod = ((worldX % WORLD_W) + WORLD_W) % WORLD_W;
      world.style.transform = `translateX(${followX() - WORLD_W - mod}px)`;
      wrap.style.transform = `translateX(-50%) scaleX(${dir})`;
    };
    place();

    const frame = () => {
      let moving = false;
      if (keys.right) { worldX += SPEED; moving = true; dir = 1; }
      if (keys.left) { worldX -= SPEED; moving = true; dir = -1; }
      place();
      stick.classList.toggle("walking", moving);
      if (moving && !movedOnce && hintRef.current) {
        movedOnce = true;
        hintRef.current.style.opacity = "0";
      }
      if (keys.left || keys.right) {
        raf = requestAnimationFrame(frame);
      } else {
        running = false;
        stick.classList.remove("walking");
      }
    };
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(frame); } };

    const typing = () => {
      const a = document.activeElement;
      const tag = a?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (a as HTMLElement | null)?.isContentEditable === true;
    };

    const onDown = (e: KeyboardEvent) => {
      if (typing()) return;
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") { keys.left = true; e.preventDefault(); start(); }
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") { keys.right = true; e.preventDefault(); start(); }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
      else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
    };
    const onResize = () => place();

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Ground line + hatch ticks. Flat & a whole number of hatch steps so the
  // tile repeats seamlessly when the world wraps.
  const groundPath = `M0 ${GROUND} L${WORLD_W} ${GROUND}`;
  let hatch = "";
  for (let gx = 0; gx < WORLD_W; gx += 40) hatch += `M${gx} ${GROUND + 3} l-9 13 `;

  // One repeating tile of the world (ground + equipment).
  const tile = (
    <>
      <path d={hatch} stroke={INK_DIM} strokeWidth={1.4} />
      <path d={groundPath} strokeWidth={2.4} />
      {EQUIP.map((e, i) => (
        <g key={i} transform={`translate(${e.x} ${GROUND})`}>{e.el}</g>
      ))}
    </>
  );

  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      <style>{`
        @keyframes legA { 0%{transform:rotate(24deg)} 50%{transform:rotate(-24deg)} 100%{transform:rotate(24deg)} }
        @keyframes legB { 0%{transform:rotate(-24deg)} 50%{transform:rotate(24deg)} 100%{transform:rotate(-24deg)} }
        @keyframes armA { 0%{transform:rotate(-18deg)} 50%{transform:rotate(18deg)} 100%{transform:rotate(-18deg)} }
        @keyframes armB { 0%{transform:rotate(18deg)} 50%{transform:rotate(-18deg)} 100%{transform:rotate(18deg)} }
        @keyframes bob  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        /* Positioning lives on the OUTER group (svg transform attribute); the
           rotation lives on the INNER .limb (CSS) so the walk animation never
           wipes out the limb's position. Pivot = the limb's local origin. */
        .limb { transform-box: fill-box; transform-origin: 0 0; }
        .gs-stick .arm-b { transform: rotate(13deg); }
        .gs-stick .arm-f { transform: rotate(-13deg); }
        .gs-stick .leg-b { transform: rotate(9deg); }
        .gs-stick .leg-f { transform: rotate(-9deg); }
        .gs-stick.walking .leg-f { animation: legA .46s linear infinite; }
        .gs-stick.walking .leg-b { animation: legB .46s linear infinite; }
        .gs-stick.walking .arm-f { animation: armA .46s linear infinite; }
        .gs-stick.walking .arm-b { animation: armB .46s linear infinite; }
        .gs-stick.walking .gs-bob { animation: bob .46s linear infinite; }
      `}</style>

      {/* Infinite scrolling world: three repeating tiles of ground + equipment */}
      <div
        ref={worldRef}
        style={{ position: "absolute", left: 0, bottom: 84, width: WORLD_W * 3, height: SCENE_H, willChange: "transform" }}
      >
        <svg
          width={WORLD_W * 3} height={SCENE_H} viewBox={`0 0 ${WORLD_W * 3} ${SCENE_H}`}
          fill="none" stroke={INK} strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round"
        >
          {[0, 1, 2].map((c) => (
            <g key={c} transform={`translate(${c * WORLD_W} 0)`}>{tile}</g>
          ))}
        </svg>
      </div>

      {/* Player stickman (fixed on screen; the world scrolls behind him).
          bottom is set so the feet (svg y≈102 of 120) land on the ground line,
          which sits at world bottom (84) + (SCENE_H − GROUND = 90) = 174px. */}
      <div ref={stickWrapRef} style={{ position: "absolute", left: "26%", bottom: 156, width: 70, height: 120, transform: "translateX(-50%)" }}>
        <svg width="70" height="120" viewBox="0 0 70 120" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <g ref={stickRef} className="gs-stick">
            <g className="gs-bob">
              <circle cx="35" cy="16" r="10" />
              <line x1="35" y1="26" x2="35" y2="72" />
              <g transform="translate(35 32)"><g className="limb arm-b"><line x1="0" y1="0" x2="1" y2="22" /></g></g>
              <g transform="translate(35 32)"><g className="limb arm-f"><line x1="0" y1="0" x2="1" y2="22" /></g></g>
              <g transform="translate(35 72)"><g className="limb leg-b"><line x1="0" y1="0" x2="1" y2="30" /></g></g>
              <g transform="translate(35 72)"><g className="limb leg-f"><line x1="0" y1="0" x2="1" y2="30" /></g></g>
            </g>
          </g>
        </svg>
      </div>

      {/* Controls hint */}
      <div
        ref={hintRef}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 28, textAlign: "center",
          fontSize: 11.5, letterSpacing: "0.06em", color: INK_DIM,
          transition: "opacity 0.6s ease",
        }}
      >
        ← → to walk through the gym
      </div>
    </div>
  );
}
