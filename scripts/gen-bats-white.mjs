#!/usr/bin/env node
// White-silhouette front-facing bat (deep-V wings, body, square eye-holes, ear bumps), flapping.
// Matches the reference shape in one colour. 20 variations.
// Output: web/public/bat-white-20.html   Preview: node scripts/gen-bats-white.mjs --ascii 3
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FILL = '#ffffff';
const SCALE = 4;
const STAGE = 320;

// Chosen favourite refinements (applied in --one mode): W18, shorter body & bones
const CHOSEN = { dBodyH: 2, dTailH: 0, dThick: 3, fingerMul: 0.7 };

// mulberry32 — good avalanche so nearby/evenly-spaced seeds give decorrelated streams
function rng(seed) {
  let a = (Math.imul(seed ^ 0x9e3779b9, 2654435761) >>> 0);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng2 = rng;

// Build one flap frame -> Set "x,y" (right half built, mirrored about cx). Eyes are holes.
function frame(p, lift, scatterSeed) {
  const fill = new Set();
  const holes = new Set();
  const cx = p.cx;
  const add = (x, y) => { x = Math.round(x); y = Math.round(y); fill.add(`${x},${y}`); fill.add(`${2 * cx - x},${y}`); };
  const hole = (x, y) => { x = Math.round(x); y = Math.round(y); holes.add(`${x},${y}`); holes.add(`${2 * cx - x},${y}`); };

  const addAbs = (x, y) => { fill.add(`${Math.round(x)},${Math.round(y)}`); };  // no mirror
  const hcy = p.headCy, hr = p.headR;
  const shY = hcy - 1;

  // One wing, drawn independently per side so left & right can differ.
  // side = +1 (right) / -1 (left).  w = that wing's own params.
  function drawWing(side, w) {
    const shX = cx + side * (hr - 1);
    const tipX = cx + side * w.span;
    const tipY = shY - w.tipRise;   // flap handled by `swing` below (whole wing moves)
    const steps = Math.abs(tipX - shX);
    // curved leading edge: rise to the tip + a sinusoidal bow (w.curve) → crescent sweep.
    // on the down-beat the WHOLE wing swings down (more area moves), not just the tip.
    const swing = lift < 0 ? w.flap : 0;
    const topEdge = (f) => {
      const s = Math.pow(f, 0.7);
      return shY * (1 - s) + (tipY) * s - w.curve * Math.sin(Math.PI * Math.pow(f, w.curveBias)) + swing * f;
    };
    for (let k = 0; k <= steps; k++) {
      const x = shX + side * k;
      const f = k / Math.max(1, steps);
      const ty = topEdge(f);
      const spine = Math.max(2, w.thick * 0.40 * (1 - Math.pow(f, 1.3)));   // thinner solid arm
      const phase = f * w.fingers;
      const t = phase - Math.floor(phase);
      const point = Math.pow(Math.max(0, 1 - Math.abs(t - 0.5) * 2), w.sharp); // sharp finger tip
      const fingerLen = w.thick * (w.fingerMul ?? 0.95) * (1 - Math.pow(f, 0.95)) * point;  // bone spikes
      const by = ty + spine + fingerLen;
      for (let y = Math.round(ty); y <= Math.round(by); y++) addAbs(x, y);
    }
    // thumb claw on the wrist + sharpened tip
    const wf = w.clawF, wx = shX + side * steps * wf, wy = topEdge(wf);
    for (let i = 0; i < w.clawH; i++) addAbs(wx + side * i * 0.4, wy - 1 - i);
    addAbs(tipX + side, tipY); addAbs(tipX, tipY - 1);
  }
  drawWing(1, p.wng);          // symmetrical: same params both sides
  drawWing(-1, p.wng);

  // ---- distinct body parts: round head · slim neck · slim tapering torso ----
  // slim torso (narrow, tapers toward the tail)
  const neckY = hcy + 1;
  for (let y = 0; y < p.bodyH; y++) {
    const t = y / Math.max(1, p.bodyH - 1);
    const w = Math.max(0, Math.round(p.bodyW * (1 - 0.55 * t)));   // slim & tapering
    for (let x = 0; x <= w; x++) add(cx + x, neckY + y);
  }
  // round head, sitting above the torso (clear separation)
  const headY = hcy - hr;
  for (let y = -hr; y <= hr; y++) {
    const w = Math.round(Math.sqrt(Math.max(0, hr * hr - y * y)));
    for (let x = 0; x <= w; x++) add(cx + x, headY + y);
  }
  // narrow neck linking head to torso
  add(cx, hcy); add(cx + (p.bodyW > 2 ? 1 : 0), hcy);
  // two clean TRIANGULAR ears on top of the head, notch between them
  const earCtr = cx + p.earOff, earBaseY = headY - hr;
  for (let i = 0; i < p.earH; i++) {
    const tt = i / Math.max(1, p.earH - 1);                 // 0 base → 1 tip
    const hw = Math.max(0, Math.round(p.earW * (1 - tt)));  // half-width shrinks to a point
    for (let x = -hw; x <= hw; x++) add(earCtr + x, earBaseY - i);
  }
  // pointed tail tapering below the slim torso
  const tailTop = neckY + p.bodyH;
  for (let i = 0; i < p.tailH; i++) {
    const w = Math.max(0, Math.round((p.bodyW - 1) * (1 - i / p.tailH)) - 1);
    for (let x = 0; x <= Math.max(0, w); x++) add(cx + x, tailTop + i);
  }
  // little splayed feet / legs flanking the tail (omitted when minimal)
  if (p.footH > 0) {
    for (let i = 0; i < p.footH; i++) add(cx + p.footSpread + i, tailTop - 1 + i);
    add(cx + p.footSpread + p.footH, tailTop - 2 + p.footH);  // toe point
  }

  // small eye holes on the head
  for (let ex = 0; ex < p.eyeW; ex++) for (let ey = 0; ey < p.eyeH; ey++)
    hole(cx + p.eyeOff + ex, headY + p.eyeRow + ey);

  for (const h of holes) fill.delete(h);

  // ---- scatter: loose pixels flung outward from the silhouette edges (the "vibe") ----
  const pts = [...fill].map(k => k.split(',').map(Number));
  let cyc = 0; for (const [, y] of pts) cyc += y; cyc /= pts.length;
  const sr = rng2(scatterSeed);
  const scat = new Set();
  const earTopY = headY - hr - p.earH;   // keep the zone just above/between the ears clear
  let placed = 0, tries = 0;
  while (placed < p.scatter && tries < p.scatter * 12) {
    tries++;
    const [bx, by] = pts[Math.floor(sr() * pts.length)];
    // push outward from the centre so particles ring the bat
    const dx0 = bx - cx, dy0 = by - cyc, len = Math.hypot(dx0, dy0) || 1;
    const dist = 1 + Math.floor(sr() * p.scatterDist);
    const jitter = (sr() - 0.5) * 1.4;
    const x = Math.round(bx + (dx0 / len) * dist + jitter);
    const y = Math.round(by + (dy0 / len) * dist + jitter * 0.7);
    const key = `${x},${y}`;
    if (fill.has(key)) continue;
    // don't litter the ear gap — keep the head/ears readable
    if (y < earTopY + 1 && Math.abs(x - cx) < p.earOff + 4) continue;
    // thin the farther particles out so density fades with distance
    if (dist > 2 && sr() < (dist - 2) / p.scatterDist) continue;
    fill.add(key);
    placed++;
    scat.add(key);
  }

  // ---- tilt the whole bat by p.angle (crisp grid rotation, fixed pivot) ----
  if (p.angle) return rotateSet(fill, scat, p.angle, cx, hcy + 2);
  return fill;
}

// Rotate a pixel set about (cx,cy) by `deg`. Silhouette uses inverse-map (no holes);
// loose scatter uses forward-map so individual sparkles survive.
function rotateSet(fill, scat, deg, cx, cy) {
  const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const k of fill) { const [x, y] = k.split(',').map(Number); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const pad = Math.ceil(Math.hypot(maxX - minX, maxY - minY) / 2) + 2;
  const out = new Set();
  for (let oy = minY - pad; oy <= maxY + pad; oy++) {
    for (let ox = minX - pad; ox <= maxX + pad; ox++) {
      const dx = ox - cx, dy = oy - cy;
      const sx = Math.round(cx + dx * cos + dy * sin);
      const sy = Math.round(cy - dx * sin + dy * cos);
      if (fill.has(`${sx},${sy}`) && !scat.has(`${sx},${sy}`)) out.add(`${ox},${oy}`);
    }
  }
  for (const k of scat) {
    const [x, y] = k.split(',').map(Number), dx = x - cx, dy = y - cy;
    out.add(`${Math.round(cx + dx * cos - dy * sin)},${Math.round(cy + dx * sin + dy * cos)}`);
  }
  return out;
}

function makeBat(seed, ov = {}) {
  const r = rng(seed), ri = (a, b) => Math.round(a + (b - a) * r()), pk = (a, b) => a + (b - a) * r();
  // ONE symmetrical wing, used for both sides — minimal: clean, few fingers, no claw
  const wng = {
    span: ri(28, 34),                      // wingspan (larger)
    tipRise: ri(2, 8),
    flap: ri(7, 11),                       // flap sweep
    curve: pk(4, 9),                       // bow of the curved leading edge
    curveBias: pk(0.8, 1.5),               // where the bow peaks along the wing
    thick: ri(13, 18),                     // wing HEIGHT (vertical membrane area)
    fingers: [3, 3, 4][Math.floor(r() * 3)],
    sharp: pk(3.0, 4.2),                   // higher = sharper finger bones
    clawF: 0, clawH: 0,                    // no thumb claw (minimal)
  };

  const p = {
    cx: 38,
    headCy: ri(12, 14), headR: ri(2, 3), bodyW: 2, bodyH: ri(7, 9),   // SLIM torso, distinct round head
    earH: ri(1, 2), earW: 0, earOff: ri(1, 2),               // tiny 1px line ears
    footH: 0, footSpread: 2,                                  // no feet (minimal)
    wng,
    tailH: ri(2, 3),
    eyeW: 1, eyeH: 1, eyeOff: 1, eyeRow: 0,
    scatter: ri(3, 7),            // just a few loose pixels (minimal)
    scatterDist: ri(3, 5),        // how far they fling out
    angle: Math.round((r() * 2 - 1) * 24),   // overall tilt: −24°..+24°
  };
  // optional per-bat refinements (e.g. for a chosen favourite)
  if (ov.dBodyH) p.bodyH += ov.dBodyH;
  if (ov.dTailH) p.tailH += ov.dTailH;
  if (ov.dThick) p.wng.thick += ov.dThick;
  if (ov.dSpan) p.wng.span += ov.dSpan;
  if (ov.fingerMul !== undefined) p.wng.fingerMul = ov.fingerMul;
  if (ov.scatter !== undefined) p.scatter = ov.scatter;
  if (ov.scatterDist !== undefined) p.scatterDist = ov.scatterDist;
  if (ov.angle !== undefined) p.angle = ov.angle;

  // different scatter seeds per frame so the loose pixels twinkle while wings flap
  return { up: frame(p, 1, seed * 3 + 1), down: frame(p, -1, seed * 3 + 2), p };
}

function ascii(set) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const k of set) { const [x, y] = k.split(',').map(Number); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  let o = '';
  for (let y = minY; y <= maxY; y++) { let s = ''; for (let x = minX; x <= maxX; x++) s += set.has(`${x},${y}`) ? '█' : ' '; o += s + '\n'; }
  return o;
}
function shadow(set) { return [...set].map(k => { const [x, y] = k.split(','); return `${x}px ${y}px 0 ${FILL}`; }).join(', '); }

const args = process.argv.slice(2);
if (args[0] === '--ascii') {
  const n = parseInt(args[1] || '1', 10), b = makeBat(500 + n * 91, args[2] === 'chosen' ? CHOSEN : {});
  console.log(`=== ${n} UP (tilt ${b.p.angle}°) ===\n` + ascii(b.up) + `\n=== ${n} DOWN ===\n` + ascii(b.down));
  process.exit(0);
}
if (args[0] === '--angles') {
  console.log([...Array(20)].map((_, i) => `W${i + 1}:${makeBat(500 + (i + 1) * 91).p.angle}`).join('  '));
  process.exit(0);
}
// --one N : render a single chosen bat (with the CHOSEN overrides) large & flapping
if (args[0] === '--one') {
  const n = parseInt(args[1] || '18', 10);
  const b = makeBat(500 + n * 91, CHOSEN);
  const sc = 8;
  const html = `<!doctype html><meta charset=utf8><title>Bat W${n}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15171c}
.s{width:1px;height:1px;transform:scale(${sc});animation:.5s f steps(1) infinite}
@keyframes f{0%{box-shadow:${shadow(b.up)}}50%{box-shadow:${shadow(b.down)}}100%{box-shadow:${shadow(b.up)}}}</style>
<span class=s></span>`;
  const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'bat-final.html');
  writeFileSync(p, html);
  console.log('wrote', p);
  process.exit(0);
}

// --component : emit web/components/BatMark.tsx (static logo + flapping loader)
if (args[0] === '--component') {
  const n = parseInt(args[1] || '18', 10), seed = 500 + n * 91;
  const logo = makeBat(seed, { ...CHOSEN, scatter: 0, angle: 0 }).up;   // clean, upright, no specks
  const fl = makeBat(seed, { ...CHOSEN, scatter: 38, scatterDist: 15 }); // flapping loader: many widely-spread flickering specks
  // separate bounds: keep the static logo tight while the loader's spread specks get their own box
  const boundsOf = (arr) => {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const s of arr) for (const k of s) { const [x, y] = k.split(',').map(Number); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return { minX, minY, W: maxX - minX + 1, H: maxY - minY + 1 };
  };
  const lb = boundsOf([logo]), fb = boundsOf([fl.up, fl.down]);
  const pathOf = (s, b) => [...s].map(k => { const [x, y] = k.split(',').map(Number); return `M${x - b.minX} ${y - b.minY}h1v1h-1z`; }).join('');
  const tsx = `"use client";
import type { CSSProperties } from "react";
// AUTO-GENERATED by scripts/gen-bats-white.mjs --component  (do not edit by hand)
// Pixel-art bat mark on a TRANSPARENT background. Single colour via \`currentColor\`.
const VB_LOGO = "0 0 ${lb.W} ${lb.H}";
const VB_FLAP = "0 0 ${fb.W} ${fb.H}";
const LOGO = "${pathOf(logo, lb)}";
const UP = "${pathOf(fl.up, fb)}";
const DOWN = "${pathOf(fl.down, fb)}";

export default function BatMark({
  size = 32,
  flapping = false,
  speed = 0.5,
  className,
  style,
}: {
  size?: number;
  flapping?: boolean;
  speed?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const base = {
    className,
    style: { display: "block", ...style } as CSSProperties,
    "aria-hidden": true as const,
    shapeRendering: "crispEdges" as const,
  };
  if (!flapping) {
    return (
      <svg {...base} width={size} height={(size * ${lb.H}) / ${lb.W}} viewBox={VB_LOGO}>
        <path d={LOGO} fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...base} width={size} height={(size * ${fb.H}) / ${fb.W}} viewBox={VB_FLAP}>
      <style>{\`
        @keyframes bm-a { 0% { opacity: 1 } 50% { opacity: 0 } 100% { opacity: 1 } }
        @keyframes bm-b { 0% { opacity: 0 } 50% { opacity: 1 } 100% { opacity: 0 } }
        .bm-up   { animation: bm-a \${speed}s steps(1) infinite; }
        .bm-down { animation: bm-b \${speed}s steps(1) infinite; }
        @media (prefers-reduced-motion: reduce) {
          .bm-up { animation: none; opacity: 1; }
          .bm-down { animation: none; opacity: 0; }
        }
      \`}</style>
      <path className="bm-up" d={UP} fill="currentColor" />
      <path className="bm-down" d={DOWN} fill="currentColor" />
    </svg>
  );
}
`;
  const p = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'components', 'BatMark.tsx');
  writeFileSync(p, tsx);
  console.log('wrote', p, `(logo ${lb.W}x${lb.H}, flap ${fb.W}x${fb.H})`);
  process.exit(0);
}

// --export : write downloadable assets — bat-logo.svg + a pixel JSON for PNG rasterising
if (args[0] === '--export') {
  const n = parseInt(args[1] || '18', 10), seed = 500 + n * 91;
  const logo = makeBat(seed, { ...CHOSEN, scatter: 0, angle: 0 }).up;   // clean, upright
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const k of logo) { const [x, y] = k.split(',').map(Number); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const pixels = [...logo].map(k => { const [x, y] = k.split(',').map(Number); return [x - minX, y - minY]; });
  const path = pixels.map(([x, y]) => `M${x} ${y}h1v1h-1z`).join('');
  const svgFor = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 8}" height="${H * 8}" shape-rendering="crispEdges">
  <path d="${path}" fill="${fill}"/>
</svg>
`;
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'public', 'bat-logo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bat-logo.svg'), svgFor('#ffffff'));          // white on transparent
  writeFileSync(join(dir, 'bat-logo-current.svg'), svgFor('currentColor')); // recolour via CSS
  writeFileSync(join(dir, 'bat-logo.pixels.json'), JSON.stringify({ W, H, pixels }));
  console.log('wrote web/public/bat-logo/{bat-logo.svg, bat-logo-current.svg, bat-logo.pixels.json}', `(${W}x${H})`);
  process.exit(0);
}

const N = 20; let cards = '', styles = '';
for (let i = 1; i <= N; i++) {
  const b = makeBat(500 + i * 91), cls = `w${i}`;
  cards += `<div class=card><div class=stage><span class="${cls}"></span></div><div class=label>W${i}</div></div>\n`;
  styles += `.${cls}{width:1px;height:1px;transform:scale(${SCALE});position:relative;left:${-STAGE / 2 + 0.5}px;top:${-STAGE / 2 + 0.5}px;animation:.5s f${cls} steps(1) infinite}\n`;
  styles += `@keyframes f${cls}{0%{box-shadow:${shadow(b.up)}}50%{box-shadow:${shadow(b.down)}}100%{box-shadow:${shadow(b.up)}}}\n`;
}
const html = `<!doctype html><meta charset=utf8><title>Bat — white (20)</title>
<style>body{margin:0;background:#15171c;color:#cfd3da;font-family:Inter,system-ui,sans-serif}
h1{font-size:18px;padding:24px 28px 4px}p.sub{padding:0 28px;opacity:.55;font-size:13px;margin:0 0 12px}
.grid{display:flex;flex-wrap:wrap;gap:22px;padding:24px 28px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px;display:flex;flex-direction:column;align-items:center;gap:12px}
.stage{width:${STAGE}px;height:${STAGE}px;display:flex;align-items:center;justify-content:center;overflow:visible}
.label{font-size:12.5px;opacity:.8}
${styles}</style>
<h1>Gym Days — white pixel bat (20)</h1><p class=sub>Single-colour silhouette · flapping · pick a number.</p>
<div class=grid>\n${cards}</div>`;
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'web', 'public', 'bat-white-20.html');
writeFileSync(out, html);
console.log('wrote', out);
