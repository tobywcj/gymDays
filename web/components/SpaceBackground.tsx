"use client";

import { useEffect, useRef } from "react";

// Dark-grey "deep space" backdrop for the whole app. A fixed, full-screen
// canvas painted behind all chrome (see .app-backdrop / layout.tsx):
//   • small twinkling stars in cool greys/whites over the dark-grey void
//   • a few drifting layers that ease toward the cursor (parallax)
//   • occasional shooting stars
// Kept subtle (low alpha, gentle twinkle) so it never overpowers the glass
// cards in front. Honours prefers-reduced-motion (single static frame).

type Star = {
  x: number;
  y: number;
  z: number;        // depth 0..1 — size, brightness, parallax
  r: number;
  tw: number;       // twinkle phase
  twSpeed: number;
  warm: boolean;
};

type Shooter = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  len: number;
};

export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    if (!ctx) return;
    const cv = canvas;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let stars: Star[] = [];
    const shooters: Shooter[] = [];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

    function build() {
      w = window.innerWidth;
      h = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(240, Math.round((w * h) / 7800));
      stars = Array.from({ length: count }, () => {
        const z = Math.random();
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          z,
          r: 0.4 + z * 1.3,
          tw: Math.random() * Math.PI * 2,
          twSpeed: 0.5 + Math.random() * 1.6,
          warm: Math.random() > 0.88,
        };
      });
    }

    function drawStars(t: number) {
      for (const s of stars) {
        const px = s.x + pointer.x * (6 + s.z * 34);
        const py = s.y + pointer.y * (6 + s.z * 34);
        const twinkle = reduceMotion ? 0.85 : 0.65 + 0.35 * Math.sin(t * 0.001 * s.twSpeed + s.tw);
        const alpha = (0.18 + s.z * 0.5) * twinkle;
        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.warm
          ? `rgba(228, 214, 198, ${alpha})`
          : `rgba(216, 220, 230, ${alpha})`;
        ctx.fill();
        if (s.z > 0.85) {
          ctx.beginPath();
          ctx.arc(px, py, s.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(220, 226, 236, ${alpha * 0.1})`;
          ctx.fill();
        }
      }
    }

    function spawnShooter() {
      const fromLeft = Math.random() < 0.5;
      const angle = Math.PI * (0.13 + Math.random() * 0.18);
      const speed = 8 + Math.random() * 7;
      shooters.push({
        x: fromLeft ? -40 : Math.random() * w,
        y: fromLeft ? Math.random() * h * 0.5 : -30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        len: 90 + Math.random() * 130,
      });
    }

    function drawShooters() {
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life -= 0.012;
        if (sh.life <= 0 || sh.x > w + 60 || sh.y > h + 60) {
          shooters.splice(i, 1);
          continue;
        }
        const tx = sh.x - sh.vx * (sh.len / 12);
        const ty = sh.y - sh.vy * (sh.len / 12);
        const g = ctx.createLinearGradient(sh.x, sh.y, tx, ty);
        g.addColorStop(0, `rgba(236, 238, 244, ${0.85 * sh.life})`);
        g.addColorStop(1, "rgba(236, 238, 244, 0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }

    function frame(t: number) {
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      ctx.clearRect(0, 0, w, h);
      drawStars(t);
      if (!reduceMotion) {
        if (shooters.length < 2 && Math.random() < 0.004) spawnShooter();
        drawShooters();
      }
      raf = requestAnimationFrame(frame);
    }

    function onPointerMove(e: PointerEvent) {
      pointer.tx = e.clientX / window.innerWidth - 0.5;
      pointer.ty = e.clientY / window.innerHeight - 0.5;
    }

    let raf = 0;
    build();

    if (reduceMotion) {
      ctx.clearRect(0, 0, w, h);
      drawStars(0);
    } else {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      raf = requestAnimationFrame(frame);
    }

    const onResize = () => build();
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="app-backdrop" aria-hidden />;
}
