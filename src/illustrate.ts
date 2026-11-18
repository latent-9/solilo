// illustrate: draw real two-tone vector art in the flat, hand-inked spirit of
// the Claude blog's spot illustrations — filled organic paths, no strokes, a
// strict three-ink palette. This is the SVG counterpart to the ASCII tools:
// where they render text, this renders a picture.
//
// The blog's language, distilled from its own art: a 1000x1000 canvas, the root
// `fill="none"`, NO stroke anywhere, just a handful of FILLED compound paths in
// near-black ink and warm cream/paper, lifted by an accent — clay by default, or
// any hue from a small hand-tuned palette. Every motif below is an ORIGINAL path
// built from these primitives (inspired by, never copied from, the reference
// art), so the output is ours and copyright-safe.
//
// illustrate({ motif }) draws a built-in motif, procedurally inked; sharp
// rasterizes the finished SVG to a PNG preview.

import sharp from "sharp";

// --- palette ----------------------------------------------------------------
// The blog's exact three inks (cream and paper are the same value, so a cream
// shape painted over ink reads as negative space carved back to the page).
export const INK = "#141413"; // near-black, the dominant ink
export const PAPER = "#FAF9F5"; // warm cream / the page itself
export const CLAY = "#D97757"; // the default warm accent
export const CLAY_DARK = "#C46849"; // its deeper shade (used sparingly)

// A broader accent set, sampled from Anthropic's newer collage illustrations
// (the phrenology-head "mapping" piece and its siblings): steel blue, vermilion,
// rose, warm yellow, olive green. Clay stays the default; these let a motif — or
// the caller, via `accentColor` — reach past a single warm accent into the full
// spot-illustration palette. Values are hand-tuned from pixels sampled off the
// reference art, then nudged to sit well against the same ink and paper.
export const RED = "#E5432E";
export const BLUE = "#2F7DA0";
export const PINK = "#DB83B7";
export const YELLOW = "#E8C34A";
export const GREEN = "#5F8D3E";
// The one muted neutral in the engineering blog's otherwise black art — a cool
// lavender-grey used sparingly for a single shape. Kept out of the vivid
// spectrum; reachable by name for callers matching that colder register.
export const SLATE = "#C8C7D6";

// Accents addressable by name from the public API.
export const ACCENTS: Record<string, string> = {
  clay: CLAY,
  rust: CLAY_DARK,
  red: RED,
  blue: BLUE,
  pink: PINK,
  yellow: YELLOW,
  green: GREEN,
  slate: SLATE,
};

export const ACCENT_NAMES: string[] = Object.keys(ACCENTS);

// The vivid ordering a motif walks when it fans through many colors at once
// (prism rays, phrenology dots, electrons).
const SPECTRUM: string[] = [RED, CLAY, YELLOW, GREEN, BLUE, PINK];

// Resolve an accent request to a hex: a palette name, a raw #rrggbb, or clay.
function resolveAccent(name?: string): string {
  if (!name) return CLAY;
  if (/^#[0-9a-fA-F]{6}$/.test(name)) return name;
  return ACCENTS[name.toLowerCase()] ?? CLAY;
}

const TAU = Math.PI * 2;

type Point = [number, number];

// --- number + math helpers --------------------------------------------------

// Compact coordinate: 2 decimals, no negative zero, no exponent.
function num(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// Float clamp (clampInt rounds; style knobs need the fractional value kept).
function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// mulberry32 — a tiny deterministic PRNG so the "hand-drawn" wobble is stable
// for a given seed (no Math.random, which would make every render different).
function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- render style -----------------------------------------------------------
// A tiny global "graphics state" the primitives read while a motif renders:
//   roughness scales every hand-drawn wobble amplitude (0 = clean/geometric,
//             1 = the tuned default, >1 = looser/sketchier),
//   weight    scales the half-thickness of every drawn ink line (ribbon).
// It is a module singleton because the primitives are called at dozens of sites
// with no ctx in hand; withStyle() sets it for the duration of one synchronous
// render and always restores it. At the defaults (1, 1) every `* STYLE.x` is a
// multiply by exactly 1.0, so output stays byte-identical — determinism intact.
interface RenderStyle {
  roughness: number;
  weight: number;
}
let STYLE: RenderStyle = { roughness: 1, weight: 1 };

function withStyle(style: RenderStyle, fn: () => void): void {
  const prev = STYLE;
  STYLE = style;
  try {
    fn();
  } finally {
    STYLE = prev;
  }
}

// Resolve the caller's style knobs to a concrete RenderStyle. `sketch` is a
// preset (looser + a touch thinner); explicit roughness/weight override it.
function resolveStyle(opts: {
  roughness?: number;
  weight?: number;
  sketch?: boolean;
}): RenderStyle {
  const base = opts.sketch
    ? { roughness: 2.4, weight: 0.85 }
    : { roughness: 1, weight: 1 };
  return {
    roughness: clampNum(opts.roughness ?? base.roughness, 0, 4),
    weight: clampNum(opts.weight ?? base.weight, 0.2, 4),
  };
}

function jit(p: Point, rand: () => number, amt: number): Point {
  const a = amt * STYLE.roughness;
  return [p[0] + (rand() * 2 - 1) * a, p[1] + (rand() * 2 - 1) * a];
}

// --- path primitives (every one emits a FILLED `d` string, never a stroke) ---

// Straight-edged closed polygon.
function poly(pts: Point[]): string {
  if (pts.length === 0) return "";
  return "M" + pts.map((p) => `${num(p[0])} ${num(p[1])}`).join(" L") + " Z";
}

// A full-canvas rectangle (used for the paper/ink background).
function rectD(x: number, y: number, w: number, h: number): string {
  return `M${num(x)} ${num(y)} H${num(x + w)} V${num(y + h)} H${num(x)} Z`;
}

// A smooth CLOSED curve through the given points (uniform Catmull-Rom converted
// to cubic beziers). This is what gives blobs their soft, hand-inked outline.
function closedSpline(pts: Point[]): string {
  const N = pts.length;
  if (N < 3) return poly(pts);
  const seg: string[] = [`M${num(pts[0][0])} ${num(pts[0][1])}`];
  for (let i = 0; i < N; i++) {
    const p0 = pts[(i - 1 + N) % N];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % N];
    const p3 = pts[(i + 2) % N];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    seg.push(
      `C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(p2[0])} ${num(p2[1])}`,
    );
  }
  seg.push("Z");
  return seg.join(" ");
}

// An organic disc — a circle whose radius wobbles per-point so it reads as drawn
// by hand rather than struck with a compass. sx/sy squash it into an ellipse.
function disc(
  cx: number,
  cy: number,
  r: number,
  rand: () => number,
  wob = 0.05,
  count = 14,
  sx = 1,
  sy = 1,
): string {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    const rr = r * (1 + (rand() * 2 - 1) * wob * STYLE.roughness);
    pts.push([cx + Math.cos(a) * rr * sx, cy + Math.sin(a) * rr * sy]);
  }
  return closedSpline(pts);
}

// A rounded rectangle with a hair of wobble on each edge (hand-drawn panel).
function roundRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  rand?: () => number,
  j = 0,
): string {
  r = Math.min(r, w / 2, h / 2);
  const J = (): number => (rand ? (rand() * 2 - 1) * j * STYLE.roughness : 0);
  const L = x + J();
  const T = y + J();
  const R = x + w + J();
  const B = y + h + J();
  return [
    `M${num(L + r)} ${num(T)}`,
    `H${num(R - r)}`,
    `Q${num(R)} ${num(T)} ${num(R)} ${num(T + r)}`,
    `V${num(B - r)}`,
    `Q${num(R)} ${num(B)} ${num(R - r)} ${num(B)}`,
    `H${num(L + r)}`,
    `Q${num(L)} ${num(B)} ${num(L)} ${num(B - r)}`,
    `V${num(T + r)}`,
    `Q${num(L)} ${num(T)} ${num(L + r)} ${num(T)}`,
    "Z",
  ].join(" ");
}

// An annulus (ring): an outer disc with an inner disc punched out. Emitted as
// one compound path meant to be filled with fill-rule="evenodd".
function ring(
  cx: number,
  cy: number,
  ro: number,
  ri: number,
  rand: () => number,
  wob = 0.04,
): string {
  return disc(cx, cy, ro, rand, wob) + " " + disc(cx, cy, ri, rand, wob);
}

// A filled ribbon along a polyline — a drawn ink stroke (handles, brackets,
// veins, prompts). halfW is the half-thickness, constant or per-point (taper
// the ends by passing small values first/last).
function ribbon(
  points: Point[],
  halfW: number | number[],
  rand?: () => number,
  wob = 0,
): string {
  const N = points.length;
  if (N < 2) return "";
  const hw = (i: number): number => (Array.isArray(halfW) ? halfW[i] : halfW);
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < N; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(N - 1, i + 1)];
    let tx = next[0] - prev[0];
    let ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    const w =
      hw(i) *
      STYLE.weight *
      (rand && wob ? 1 + (rand() * 2 - 1) * wob * STYLE.roughness : 1);
    left.push([points[i][0] + nx * w, points[i][1] + ny * w]);
    right.push([points[i][0] - nx * w, points[i][1] - ny * w]);
  }
  return poly([...left, ...right.reverse()]);
}

// Points of a star / sparkle: `spikes` outer points alternating with inner
// valleys. Feed to poly() for crisp points or closedSpline() for soft ones.
function starPts(
  cx: number,
  cy: number,
  spikes: number,
  rOut: number,
  rIn: number,
  rand: () => number,
  wob = 0.03,
  rot = -Math.PI / 2,
): Point[] {
  const pts: Point[] = [];
  const steps = spikes * 2;
  for (let i = 0; i < steps; i++) {
    const a = rot + (i / steps) * TAU;
    const base = i % 2 === 0 ? rOut : rIn;
    const rr = base * (1 + (rand() * 2 - 1) * wob * STYLE.roughness);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return pts;
}

// A leaf / almond / eye outline: a pointed oval oriented along `ang`.
function almond(
  cx: number,
  cy: number,
  len: number,
  wid: number,
  ang: number,
  rand: () => number,
  wob = 0.04,
): string {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const at = (u: number, v: number): Point => [
    cx + u * ca - v * sa,
    cy + u * sa + v * ca,
  ];
  const L = len / 2;
  const W = wid / 2;
  const w = (): number => 1 + (rand() * 2 - 1) * wob * STYLE.roughness;
  return closedSpline([
    at(L * w(), 0),
    at(L * 0.34, W * w()),
    at(-L * 0.34, W * w()),
    at(-L * w(), 0),
    at(-L * 0.34, -W * w()),
    at(L * 0.34, -W * w()),
  ]);
}

// A flat-topped cog outline: `teeth` trapezoidal teeth around a hub.
function gearD(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  teeth: number,
  rand: () => number,
  wob = 0.015,
): string {
  const pts: Point[] = [];
  const step = TAU / teeth;
  const at = (a: number, base: number): Point => {
    const rr = base * (1 + (rand() * 2 - 1) * wob * STYLE.roughness);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
  };
  for (let i = 0; i < teeth; i++) {
    const a0 = i * step - Math.PI / 2;
    pts.push(at(a0, rIn));
    pts.push(at(a0 + step * 0.16, rOut));
    pts.push(at(a0 + step * 0.42, rOut));
    pts.push(at(a0 + step * 0.58, rIn));
  }
  return poly(pts);
}

// A rotated elliptical annulus — an orbit ring. Outer ellipse with a slightly
// smaller one punched out, both spun by `rot`. Fill with fill-rule="evenodd".
function ellipseRing(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thick: number,
  rot: number,
  rand: () => number,
  wob = 0.02,
): string {
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  const oval = (RX: number, RY: number): string => {
    const pts: Point[] = [];
    const N = 30;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const rr = 1 + (rand() * 2 - 1) * wob * STYLE.roughness;
      const ux = Math.cos(a) * RX * rr;
      const uy = Math.sin(a) * RY * rr;
      pts.push([cx + ux * ca - uy * sa, cy + ux * sa + uy * ca]);
    }
    return closedSpline(pts);
  };
  return oval(rx, ry) + " " + oval(rx - thick, ry - thick);
}

// A brain silhouette — a lumpy oval whose radius ripples (the gyri) and whose
// underside flattens a touch, so it reads as a cerebrum rather than a cloud.
function brainOutline(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rand: () => number,
): string {
  const pts: Point[] = [];
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    let rr = 1 + 0.055 * Math.sin(a * 7); // gyri ripple
    if (Math.sin(a) > 0.2) rr *= 0.92; // flatten the base
    rr *= 1 + (rand() * 2 - 1) * 0.02 * STYLE.roughness;
    pts.push([cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr]);
  }
  return closedSpline(pts);
}

// A heart, scaled from a unit template centered on (cx, cy).
function heartPts(cx: number, cy: number, s: number): Point[] {
  const T: Point[] = [
    [0, -40],
    [110, -128],
    [222, -96],
    [270, -6],
    [196, 150],
    [0, 342],
    [-196, 150],
    [-270, -6],
    [-222, -96],
    [-110, -128],
  ];
  return T.map(([x, y]) => [cx + x * s, cy + y * s] as Point);
}

// --- texture primitives (still filled compound paths, never strokes) --------

// Clip a segment to an axis-aligned rect (Liang-Barsky). Returns the trimmed
// endpoints, or null if the segment misses the rect entirely.
function clipSegRect(
  a: Point,
  b: Point,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [Point, Point] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const test = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0; // parallel to this edge: inside iff q >= 0
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (
    test(-dx, a[0] - x0) &&
    test(dx, x1 - a[0]) &&
    test(-dy, a[1] - y0) &&
    test(dy, y1 - a[1])
  ) {
    if (t1 < t0) return null;
    return [
      [a[0] + t0 * dx, a[1] + t0 * dy],
      [a[0] + t1 * dx, a[1] + t1 * dy],
    ];
  }
  return null;
}

// Parallel hatch shading filling an axis-aligned rect at any angle — a compound
// path of thin filled ribbons clipped to the rect (reads as pen shading).
export function hatch(
  x: number,
  y: number,
  w: number,
  h: number,
  angleDeg: number,
  gap: number,
  halfW: number,
  rand?: () => number,
  wob = 0,
): string {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const nx = -dy; // offset axis, perpendicular to the hatch lines
  const ny = dx;
  const corners: Point[] = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  let lo = Infinity;
  let hi = -Infinity;
  let plo = Infinity;
  let phi = -Infinity;
  for (const [cx, cy] of corners) {
    const off = cx * nx + cy * ny;
    const par = cx * dx + cy * dy;
    lo = Math.min(lo, off);
    hi = Math.max(hi, off);
    plo = Math.min(plo, par);
    phi = Math.max(phi, par);
  }
  const step = Math.max(1, gap);
  const segs: string[] = [];
  for (let off = lo + step / 2; off < hi; off += step) {
    const p0: Point = [off * nx + plo * dx, off * ny + plo * dy];
    const p1: Point = [off * nx + phi * dx, off * ny + phi * dy];
    const clipped = clipSegRect(p0, p1, x, y, x + w, y + h);
    if (clipped) segs.push(ribbon(clipped, halfW, rand, wob));
  }
  return segs.join(" ");
}

// Scatter `count` small dots inside an ellipse — a compound path of tiny discs
// (stippled grain / shading). Deterministic given the rng.
export function stipple(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count: number,
  dotR: number,
  rand: () => number,
): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * TAU;
    const r = Math.sqrt(rand()); // uniform over the disc rather than center-heavy
    const px = cx + Math.cos(a) * r * rx;
    const py = cy + Math.sin(a) * r * ry;
    parts.push(disc(px, py, dotR * (0.7 + rand() * 0.6), rand, 0.16, 7));
  }
  return parts.join(" ");
}

// A dashed run along a polyline — a compound path of filled ribbon dashes
// (guides, measurement lines). `dash`/`gap` are lengths in the design space.
export function dashed(
  points: Point[],
  halfW: number,
  dash: number,
  gap: number,
  rand?: () => number,
  wob = 0,
): string {
  if (points.length < 2) return "";
  const segs: { a: Point; b: Point; len: number; acc: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    segs.push({ a, b, len, acc: total });
    total += len;
  }
  if (!segs.length) return "";
  const at = (s: number): Point => {
    if (s <= 0) return segs[0].a;
    for (const sg of segs) {
      if (s <= sg.acc + sg.len) {
        const t = (s - sg.acc) / sg.len;
        return [sg.a[0] + (sg.b[0] - sg.a[0]) * t, sg.a[1] + (sg.b[1] - sg.a[1]) * t];
      }
    }
    return segs[segs.length - 1].b;
  };
  const period = Math.max(1, dash + Math.max(0, gap));
  const parts: string[] = [];
  for (let s = 0; s < total; s += period) {
    parts.push(ribbon([at(s), at(Math.min(total, s + dash))], halfW, rand, wob));
  }
  return parts.join(" ");
}

// --- scene ------------------------------------------------------------------

export type Background = "paper" | "none" | "ink";

// Inverting to light-on-dark is a tonal inverse of the whole picture, so the
// backdrop has to flip with the inks — otherwise an ink shape repainted in cream
// would vanish against a cream page. `none` carries no tone, so it stays
// transparent. Clay is a constant accent in both light and dark art (as in the
// blog), so it is deliberately left unchanged.
function flipBackground(bg: Background, invert: boolean): Background {
  if (!invert) return bg;
  if (bg === "paper") return "ink";
  if (bg === "ink") return "paper";
  return "none";
}

type FillRule = "nonzero" | "evenodd";
interface Shape {
  d: string;
  fill: string;
  rule?: FillRule;
}

// The blog's exact SVG envelope: root fill="none", explicit size + viewBox, an
// optional full-canvas backdrop, then the given inner markup (paths or groups).
function svgEnvelope(
  vw: number,
  vh: number,
  dw: number,
  dh: number,
  background: Background,
  inner: string,
): string {
  const lines: string[] = [
    `<svg width="${num(dw)}" height="${num(dh)}" viewBox="0 0 ${num(vw)} ${num(vh)}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
  ];
  if (background === "paper") {
    lines.push(`<path d="${rectD(0, 0, vw, vh)}" fill="${PAPER}"/>`);
  } else if (background === "ink") {
    lines.push(`<path d="${rectD(0, 0, vw, vh)}" fill="${INK}"/>`);
  }
  if (inner) lines.push(inner);
  lines.push("</svg>");
  return lines.join("\n") + "\n";
}

// Collects filled paths and serializes them, painter's-order, into one SVG in
// the blog's exact envelope.
class Scene {
  private shapes: Shape[] = [];
  constructor(
    readonly vw: number,
    readonly vh: number,
  ) {}

  fill(d: string, color: string, rule?: FillRule): this {
    if (d) this.shapes.push({ d, fill: color, rule });
    return this;
  }

  // Just the filled <path> elements — no <svg> envelope, no backdrop. compose()
  // wraps these in a <g transform> to place a motif within a larger scene.
  innerPaths(): string {
    return this.shapes
      .map((s) => {
        const rule = s.rule ? ` fill-rule="${s.rule}"` : "";
        return `<path d="${s.d}" fill="${s.fill}"${rule}/>`;
      })
      .join("\n");
  }

  toSVG(background: Background, display?: { w: number; h: number }): string {
    return svgEnvelope(
      this.vw,
      this.vh,
      display?.w ?? this.vw,
      display?.h ?? this.vh,
      background,
      this.innerPaths(),
    );
  }
}

// --- motif library (all coordinates in the 1000x1000 design space) ----------

interface Ctx {
  rand: () => number;
  ink: string;
  paper: string;
  clay: string; // the active primary accent (clay by default; set by accentColor)
  palette: string[]; // the vivid spectrum, for motifs that use many colors at once
  accent: boolean;
}
type Motif = (scene: Scene, c: Ctx) => void;

const MOTIFS: Record<string, Motif> = {
  // A four-point sparkle — the "intelligence / magic" mark.
  spark(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(closedSpline(starPts(492, 520, 4, 342, 92, rand, 0.02)), ink);
    scene.fill(
      closedSpline(starPts(772, 250, 4, 132, 36, rand, 0.03)),
      accent ? clay : ink,
    );
    scene.fill(closedSpline(starPts(248, 806, 4, 82, 22, rand, 0.03)), ink);
  },

  // A speech bubble mid-thought, with three typing dots.
  chat(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(176, 236, 648, 402, 132, rand, 13), ink);
    scene.fill(poly([[312, 596], [300, 762], [452, 604]]), ink);
    const y = 452;
    scene.fill(disc(372, y, 40, rand, 0.06), paper);
    scene.fill(disc(500, y, 40, rand, 0.06), accent ? clay : paper);
    scene.fill(disc(628, y, 40, rand, 0.06), paper);
  },

  // A magnifying glass: ink rim, clay glass, drawn handle.
  magnifier(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 430;
    const cy = 428;
    const ro = 222;
    const ri = 150;
    scene.fill(
      ribbon([[cx + ro * 0.6, cy + ro * 0.6], [802, 806]], [76, 60], rand, 0.05),
      ink,
    );
    if (accent) scene.fill(disc(cx, cy, ri + 6, rand, 0.03), clay);
    scene.fill(ring(cx, cy, ro, ri, rand, 0.03), ink, "evenodd");
    if (accent) scene.fill(disc(cx - 74, cy - 74, 30, rand, 0.1), paper);
    scene.fill(disc(806, 810, 46, rand, 0.06), ink);
  },

  // An isometric cube with a clay top face and paper seams (the "Y").
  cube(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const T: Point = [500, 172];
    const R1: Point = [792, 338];
    const R2: Point = [792, 662];
    const B: Point = [500, 828];
    const L2: Point = [208, 662];
    const L1: Point = [208, 338];
    const C: Point = [500, 500];
    scene.fill(poly([T, R1, R2, B, L2, L1]), ink);
    if (accent) scene.fill(poly([T, R1, C, L1]), clay);
    scene.fill(ribbon([C, L1], 15, rand, 0.05), paper);
    scene.fill(ribbon([C, R1], 15, rand, 0.05), paper);
    scene.fill(ribbon([C, B], 15, rand, 0.05), paper);
  },

  // A cog with a hollow hub and a clay center.
  gear(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(gearD(500, 500, 336, 264, 9, rand), ink);
    scene.fill(disc(500, 500, 122, rand, 0.04), paper);
    if (accent) scene.fill(disc(500, 500, 66, rand, 0.06), clay);
  },

  // A heart with a paper glint and a small clay echo.
  heart(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(closedSpline(heartPts(500, 420, 1).map((p) => jit(p, rand, 8))), ink);
    scene.fill(ribbon([[386, 356], [338, 448]], [26, 14], rand, 0.06), paper);
    if (accent)
      scene.fill(closedSpline(heartPts(772, 316, 0.3).map((p) => jit(p, rand, 4))), clay);
  },

  // A key: round bow with a clay center, shaft, and two teeth.
  key(scene, c) {
    const { rand, ink, clay, accent } = c;
    const bx = 316;
    const by = 500;
    const ro = 182;
    const ri = 98;
    scene.fill(roundRect(430, 468, 402, 62, 22, rand, 8), ink);
    scene.fill(roundRect(688, 530, 42, 74, 10, rand, 4), ink);
    scene.fill(roundRect(762, 530, 42, 56, 10, rand, 4), ink);
    if (accent) scene.fill(disc(bx, by, ri, rand, 0.05), clay);
    scene.fill(ring(bx, by, ro, ri, rand, 0.03), ink, "evenodd");
  },

  // A brick wall, offset courses, one clay brick.
  bricks(scene, c) {
    const { rand, ink, clay, accent } = c;
    const bw = 250;
    const bh = 116;
    const gap = 22;
    const rows = [318, 456, 594];
    for (let r = 0; r < rows.length; r++) {
      const offset = r % 2 === 0 ? 0 : -(bw + gap) / 2;
      let ci = 0;
      for (let x = 150 + offset; x < 852; x += bw + gap) {
        const isClay = accent && r === 1 && ci === 1;
        scene.fill(roundRect(x, rows[r], bw, bh, 16, rand, 7), isClay ? clay : ink);
        ci++;
      }
    }
  },

  // A city skyline with paper windows and one clay window.
  city(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const base = 852;
    const B = [
      { x: 158, w: 150, h: 300 },
      { x: 324, w: 150, h: 472 },
      { x: 490, w: 162, h: 380 },
      { x: 668, w: 150, h: 520 },
    ];
    for (let i = 0; i < B.length; i++) {
      const { x, w, h } = B[i];
      scene.fill(roundRect(x, base - h, w, h, 8, rand, 5), ink);
      const cols = 3;
      const cw = (w - 40) / cols;
      const rowsN = Math.floor((h - 70) / 74);
      for (let r = 0; r < rowsN; r++) {
        for (let cc = 0; cc < cols; cc++) {
          const wx = x + 22 + cc * cw + cw * 0.12;
          const wy = base - h + 44 + r * 74;
          const isClay = accent && i === 3 && r === 1 && cc === 1;
          scene.fill(roundRect(wx, wy, cw * 0.58, 36, 6), isClay ? clay : paper);
        }
      }
    }
  },

  // A lightning bolt with an offset clay shadow.
  bolt(scene, c) {
    const { rand, ink, clay, accent } = c;
    const base: Point[] = [
      [560, 148],
      [300, 560],
      [472, 560],
      [360, 852],
      [742, 468],
      [560, 468],
      [692, 148],
    ];
    if (accent)
      scene.fill(poly(base.map((p) => [p[0] + 34, p[1] - 6] as Point)), clay);
    scene.fill(poly(base.map((p) => jit(p, rand, 7))), ink);
  },

  // A single bold leaf: midrib and side veins carved in paper, on a stem.
  leaf(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    scene.fill(almond(cx, 476, 612, 332, -Math.PI / 2, rand, 0.05), accent ? clay : ink);
    scene.fill(ribbon([[cx, 748], [cx, 476], [cx, 208]], [4, 15, 4], rand, 0.06), paper);
    const veins: [number, number][] = [
      [560, 122],
      [476, 150],
      [392, 122],
    ];
    for (const [yy, dx] of veins) {
      scene.fill(ribbon([[cx, yy], [cx - dx, yy - 74]], [9, 3], rand, 0.05), paper);
      scene.fill(ribbon([[cx, yy], [cx + dx, yy - 74]], [9, 3], rand, 0.05), paper);
    }
    scene.fill(ribbon([[cx, 748], [cx + 6, 902]], [16, 8], rand, 0.05), ink);
  },

  // An open eye: ink outline, paper sclera, clay iris, ink pupil, paper glint.
  eye(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    scene.fill(almond(cx, cy, 648, 300, 0, rand, 0.03), ink);
    scene.fill(almond(cx, cy, 564, 236, 0, rand, 0.03), paper);
    if (accent) scene.fill(disc(cx, cy, 118, rand, 0.03), clay);
    scene.fill(disc(cx, cy, 66, rand, 0.04), ink);
    scene.fill(disc(cx - 30, cy - 30, 20, rand, 0.1), paper);
  },

  // A five-point star with a clay inner star (or a paper center).
  star(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(poly(starPts(500, 512, 5, 344, 150, rand, 0.02)), ink);
    if (accent) scene.fill(poly(starPts(500, 512, 5, 150, 64, rand, 0.03)), clay);
    else scene.fill(disc(500, 512, 60, rand, 0.05), paper);
  },

  // A retro stage microphone in the Shure-55 idiom: a wide chrome capsule head
  // with a domed top and a bright band across the grille, cradled in a yoke that
  // sweeps from side pivots down to a joint on an angled stand. Chrome reads as
  // paper, the grille and hardware as ink, the pivots carry the accent.
  microphone(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // The yoke: two arms sweeping from the head's side pivots to a lower joint,
    // drawn first so the head's rim tucks over their tops like a real cradle.
    scene.fill(ribbon([[300, 392], [292, 556], [408, 652], [512, 674]], 22, rand, 0.03), ink);
    scene.fill(ribbon([[700, 392], [708, 556], [592, 652], [512, 674]], 22, rand, 0.03), ink);
    // An angled stand tube dropping from the joint, leaning for a bit of life.
    scene.fill(ribbon([[512, 668], [536, 764], [576, 876]], [30, 26, 32], rand, 0.03), ink);
    scene.fill(roundRect(470, 632, 92, 76, 28, rand, 4), ink); // joint housing
    scene.fill(disc(516, 670, 21, rand, 0.08), accent ? clay : paper); // pivot bolt
    // Head: a wide chrome capsule — domed rim in ink, inset face in paper.
    scene.fill(roundRect(292, 132, 416, 452, 200, rand, 8), ink);
    scene.fill(roundRect(336, 178, 328, 356, 158, rand, 5), paper);
    // Grille slats split into two banks by a bright chrome band across the middle.
    for (let i = 0; i < 4; i++) scene.fill(roundRect(372, 212 + i * 30, 256, 16, 8, rand, 2), ink);
    for (let i = 0; i < 4; i++) scene.fill(roundRect(372, 398 + i * 30, 256, 16, 8, rand, 2), ink);
    // The band: two ink edges framing the bright paper strip between the banks.
    scene.fill(roundRect(356, 332, 288, 9, 4, rand, 1), ink);
    scene.fill(roundRect(356, 379, 288, 9, 4, rand, 1), ink);
    // A gleam swept along the domed top rim.
    scene.fill(ribbon([[372, 176], [500, 160], [628, 176]], 7, rand, 0.04), paper);
    // Side pivot screws where the yoke grips the head.
    scene.fill(disc(300, 392, 30, rand, 0.05), ink);
    scene.fill(disc(700, 392, 30, rand, 0.05), ink);
    scene.fill(disc(300, 392, 13, rand, 0.1), accent ? clay : paper);
    scene.fill(disc(700, 392, 13, rand, 0.1), accent ? clay : paper);
  },

  // A terminal / code window: paper screen, prompt, command lines, clay cursor.
  terminal(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(150, 220, 700, 560, 46, rand, 8), ink);
    scene.fill(roundRect(196, 320, 608, 420, 22), paper);
    scene.fill(disc(238, 270, 17, rand, 0.08), paper);
    scene.fill(disc(292, 270, 17, rand, 0.08), accent ? clay : paper);
    scene.fill(disc(346, 270, 17, rand, 0.08), paper);
    scene.fill(ribbon([[248, 428], [320, 470], [248, 512]], 17, rand, 0.05), ink);
    scene.fill(roundRect(352, 456, 300, 28, 14), ink);
    scene.fill(roundRect(248, 562, 456, 28, 14), ink);
    scene.fill(roundRect(248, 624, 62, 42, 6), accent ? clay : ink);
  },

  // A human brain: lumpy cerebrum with smooth gyri carved in paper, a central
  // fissure, an accent cerebellum, and a short brainstem.
  brain(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 496;
    const cy = 470;
    scene.fill(brainOutline(cx, cy, 344, 300, rand), ink);
    // A smooth wavy groove, sampled along a sine so ribbon() reads as a fold.
    const groove = (x0: number, x1: number, y: number, amp: number, waves: number): Point[] => {
      const pts: Point[] = [];
      const N = 12;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push([x0 + (x1 - x0) * t, y + Math.sin(t * Math.PI * waves) * amp]);
      }
      return pts;
    };
    // The long central fissure, meandering top to bottom.
    scene.fill(
      ribbon(
        [[cx - 4, 192], [cx + 18, 320], [cx - 10, 452], [cx + 18, 592], [cx - 2, 720]],
        [7, 12, 13, 12, 7],
        rand,
        0.05,
      ),
      paper,
    );
    // Gyri: a few gently waving grooves on each hemisphere.
    const folds: [number, number, number, number, number][] = [
      [252, cx - 48, 336, 20, 2],
      [250, cx - 46, 414, 24, 2.2],
      [266, cx - 54, 494, 22, 2],
      [292, cx - 60, 572, 18, 1.8],
      [cx + 48, 742, 336, 20, 2],
      [cx + 46, 748, 414, 24, 2.2],
      [cx + 54, 730, 494, 22, 2],
      [cx + 60, 706, 572, 18, 1.8],
    ];
    for (const [x0, x1, y, amp, w] of folds) {
      scene.fill(ribbon(groove(x0, x1, y, amp, w), 8, rand, 0.04), paper);
    }
    // Cerebellum lobe (lower back), in the accent, tucked against the base.
    if (accent) {
      scene.fill(disc(648, 700, 106, rand, 0.05, 16, 1, 0.78), clay);
      scene.fill(ribbon(groove(586, 716, 690, 9, 2), 5, rand, 0.04), paper);
      scene.fill(ribbon(groove(586, 716, 722, 9, 2), 5, rand, 0.04), paper);
    }
    // Brainstem.
    scene.fill(ribbon([[548, 724], [540, 866]], [26, 14], rand, 0.05), ink);
  },

  // A profile head marked up like a phrenology chart: an ink silhouette, a dotted
  // measurement grid in paper, and a spread of vivid measurement dots.
  head(scene, c) {
    const { rand, ink, paper, palette } = c;
    const profile: Point[] = [
      [520, 168], [690, 238], [750, 452], [702, 636], [666, 726],
      [678, 812], [556, 812], [470, 702], [372, 648], [350, 610],
      [356, 566], [250, 548], [330, 486], [300, 452], [356, 410], [352, 320],
    ];
    scene.fill(closedSpline(profile.map((p) => jit(p, rand, 5))), ink);
    // Dotted construction lines (paper), the phrenologist's grid.
    for (let y = 236; y <= 760; y += 46) scene.fill(disc(506, y, 6, rand, 0.1), paper);
    for (let x = 336; x <= 706; x += 46) scene.fill(disc(x, 472, 6, rand, 0.1), paper);
    // Vivid mapped regions, walking the spectrum.
    const dots: Point[] = [
      [452, 300], [572, 336], [624, 470], [468, 486], [548, 604], [396, 566],
    ];
    for (let i = 0; i < dots.length; i++) {
      scene.fill(disc(dots[i][0], dots[i][1], 46, rand, 0.05), palette[i % palette.length]);
    }
  },

  // A prism splitting a dark beam into the full spectrum — the color motif.
  prism(scene, c) {
    const { rand, ink, paper, palette } = c;
    const A: Point = [500, 316];
    const B: Point = [388, 652];
    const D: Point = [616, 628];
    // Incoming beam from the left edge into the prism's left face.
    scene.fill(ribbon([[64, 486], [452, 502]], [10, 17], rand, 0.04), ink);
    // Dispersed rays fanning off the right face to the right edge.
    const ox = 566;
    const oy = 520;
    for (let i = 0; i < palette.length; i++) {
      const y2 = 368 + i * 56;
      scene.fill(ribbon([[ox, oy], [958, y2]], [18, 25], rand, 0.03), palette[i]);
    }
    // The prism itself, drawn last so the beams tuck under its edges.
    scene.fill(poly([A, B, D].map((p) => jit(p, rand, 5))), ink);
    scene.fill(ribbon([A, [500, 566]], 6, rand, 0.06), paper);
  },

  // An atom: three orbit rings, an ink nucleus with an accent core, and colored
  // electrons riding the orbits.
  atom(scene, c) {
    const { rand, ink, clay, palette } = c;
    const cx = 500;
    const cy = 500;
    const rots = [0, TAU / 6, -TAU / 6];
    for (const r of rots) {
      scene.fill(ellipseRing(cx, cy, 366, 152, 26, r, rand), ink, "evenodd");
    }
    scene.fill(disc(cx, cy, 78, rand, 0.05), ink);
    scene.fill(disc(cx, cy, 42, rand, 0.07), clay);
    const electrons: Point[] = [
      [cx - 304, cy - 44], [cx + 250, cy - 150], [cx + 150, cy + 288], [cx - 214, cy + 236],
    ];
    for (let i = 0; i < electrons.length; i++) {
      scene.fill(disc(electrons[i][0], electrons[i][1], 42, rand, 0.06), palette[i % palette.length]);
    }
  },

  // --- systems motifs -------------------------------------------------------
  // Drawn in the engineering blog's more geometric register: nodes, edges, and
  // containers rather than organic objects. Same rules (filled ink paths, a lone
  // accent, no strokes), but the vocabulary is graphs and modules.

  // A hub-and-spoke network: a central hub wired to a ring of outer nodes. The
  // graph/orchestration mark — one coordinator, many workers.
  node(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const R = 344;
    const spokes = 8;
    const ends: Point[] = [];
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * TAU - Math.PI / 2;
      ends.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    // Spokes first, so the nodes sit on top of the wire ends.
    for (const p of ends) scene.fill(ribbon([[cx, cy], p], [20, 15], rand, 0.05), ink);
    for (const p of ends) scene.fill(disc(p[0], p[1], 52, rand, 0.06), ink);
    // The hub: an ink disc with an accent core (a lit coordinator).
    scene.fill(disc(cx, cy, 94, rand, 0.04), ink);
    scene.fill(disc(cx, cy, 48, rand, 0.06), accent ? clay : c.paper);
  },

  // A 3x3 lattice of ring-cells with one solid accent cell — an array/batch with
  // a single active slot.
  grid(scene, c) {
    const { rand, ink, clay, accent } = c;
    const centers = [252, 500, 748];
    const ro = 104;
    const ri = 58;
    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        const x = centers[col];
        const y = centers[r];
        if (accent && r === 1 && col === 1) {
          scene.fill(disc(x, y, ro, rand, 0.04), clay); // the active cell
        } else {
          scene.fill(ring(x, y, ro, ri, rand, 0.04), ink, "evenodd");
        }
      }
    }
  },

  // Two ported nodes joined by a thick wire — the edge/connection mark. The far
  // node takes the accent (a directed link, source to sink).
  link(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const A: Point = [296, 704];
    const B: Point = [704, 296];
    scene.fill(ribbon([A, B], 52, rand, 0.03), ink);
    scene.fill(disc(A[0], A[1], 122, rand, 0.05), ink);
    scene.fill(disc(B[0], B[1], 122, rand, 0.05), accent ? clay : ink);
    // Paper "ports" so the nodes read as terminals, not weights.
    scene.fill(disc(A[0], A[1], 46, rand, 0.07), paper);
    scene.fill(disc(B[0], B[1], 46, rand, 0.07), paper);
  },

  // A fork fanning one root out to three tips — parallelism / one-to-many, the
  // "decouple the trunk from the branches" mark. The root carries the accent.
  fanout(scene, c) {
    const { rand, ink, clay, accent } = c;
    const forkX = 500;
    const forkY = 566;
    const footY = 846;
    const tips: Point[] = [[300, 250], [500, 210], [700, 250]];
    // Trunk (foot up to the fork) and its root node.
    scene.fill(ribbon([[forkX, footY], [forkX, forkY]], [30, 24], rand, 0.04), ink);
    scene.fill(disc(forkX, footY, 64, rand, 0.05), accent ? clay : ink);
    // Tines curving out to the tips, each capped with a node.
    for (const t of tips) {
      const mid: Point = [(forkX + t[0]) / 2, forkY - 44];
      // One half-width per point (3 points): thick at the fork, tapering to the tip.
      scene.fill(ribbon([[forkX, forkY], mid, t], [26, 20, 15], rand, 0.05), ink);
      scene.fill(disc(t[0], t[1], 56, rand, 0.06), ink);
    }
  },

  // A framed module with corner pins and a central die — the component/board
  // mark. A hollow rounded frame, four solder pads, an accent core.
  chip(scene, c) {
    const { rand, ink, clay, accent } = c;
    // The frame: an outer rounded square with an inner one punched out.
    const outer = roundRect(250, 250, 500, 500, 120, rand, 6);
    const inner = roundRect(344, 344, 312, 312, 66, rand, 6);
    scene.fill(outer + " " + inner, ink, "evenodd");
    // Corner pins sit on the frame's corners like solder pads.
    const pins: Point[] = [[250, 250], [750, 250], [750, 750], [250, 750]];
    for (const p of pins) scene.fill(disc(p[0], p[1], 72, rand, 0.05), ink);
    // The die.
    scene.fill(disc(500, 500, 74, rand, 0.05), accent ? clay : ink);
  },

  // An I-beam / H-bracket: two heavy posts joined by a crossbar — the structure
  // and containment mark. The crossbar carries the accent.
  beam(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(roundRect(226, 212, 132, 576, 34, rand, 7), ink); // left post
    scene.fill(roundRect(642, 212, 132, 576, 34, rand, 7), ink); // right post
    scene.fill(roundRect(300, 436, 400, 128, 32, rand, 6), accent ? clay : ink); // crossbar
  },

  // A radial burst: tapered slivers fanning from a center core — the broadcast /
  // emit / attention mark. The core carries the accent.
  burst(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const rays = 16;
    const r0 = 100;
    const r1 = 402;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU - Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const inner: Point = [cx + ca * r0, cy + sa * r0];
      const mid: Point = [cx + ca * (r0 + r1) / 2, cy + sa * (r0 + r1) / 2];
      const outer: Point = [cx + ca * r1, cy + sa * r1];
      // Thin at the core, fattest mid-length, sharp at the tip (a drawn sliver).
      scene.fill(ribbon([inner, mid, outer], [9, 13, 3], rand, 0.07), ink);
    }
    scene.fill(disc(cx, cy, 58, rand, 0.05), accent ? clay : ink);
  },

  // A node ladder: two rows of nodes wired top-to-bottom and linked by a bus —
  // the mesh / pipeline mark. One node carries the accent.
  mesh(scene, c) {
    const { rand, ink, clay, accent } = c;
    const xs = [280, 500, 720];
    const top = 262;
    const bot = 738;
    const midY = 500;
    for (const x of xs) scene.fill(ribbon([[x, top], [x, bot]], 24, rand, 0.03), ink);
    scene.fill(ribbon([[xs[0], midY], [xs[2], midY]], 24, rand, 0.03), ink); // the bus
    const nodes: Point[] = [];
    for (const x of xs) {
      nodes.push([x, top]);
      nodes.push([x, bot]);
    }
    for (let i = 0; i < nodes.length; i++) {
      scene.fill(disc(nodes[i][0], nodes[i][1], 58, rand, 0.06), accent && i === 0 ? clay : ink);
    }
  },

  // --- terminal / dev motifs ------------------------------------------------
  // The command line and its world: prompts, windows, code, files, version
  // control. Same rules — filled ink, one accent, no strokes.

  // A shell prompt: a chevron and a blinking cursor block.
  prompt(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(ribbon([[300, 320], [524, 500], [300, 680]], [34, 42, 34], rand, 0.03), ink);
    scene.fill(roundRect(586, 452, 150, 96, 16, rand, 6), accent ? clay : ink);
  },

  // An application window: a title bar with traffic-light dots over code lines.
  window(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(168, 236, 664, 528, 46, rand, 6), ink);
    for (let i = 0; i < 3; i++) {
      scene.fill(disc(252 + i * 70, 318, 22, rand, 0.08), accent && i === 2 ? clay : paper);
    }
    scene.fill(roundRect(202, 372, 596, 8, 4, rand, 2), paper);
    const ys = [434, 498, 562, 626];
    const ws = [430, 320, 510, 250];
    for (let i = 0; i < ys.length; i++) {
      scene.fill(roundRect(228, ys[i], ws[i], 30, 12, rand, 3), accent && i === 3 ? clay : paper);
    }
  },

  // A pair of curly braces around a dot — code, a block, an object.
  braces(scene, c) {
    const { rand, ink, clay, accent } = c;
    const hw = [20, 24, 26, 30, 26, 24, 20];
    const L: Point[] = [[452, 282], [402, 302], [392, 430], [338, 500], [392, 570], [402, 698], [452, 718]];
    const R: Point[] = [[548, 282], [598, 302], [608, 430], [662, 500], [608, 570], [598, 698], [548, 718]];
    scene.fill(ribbon(L, hw, rand, 0.03), ink);
    scene.fill(ribbon(R, hw, rand, 0.03), ink);
    scene.fill(disc(500, 500, 40, rand, 0.06), accent ? clay : ink);
  },

  // A blinking I-beam caret dropped into a few lines of text.
  cursor(scene, c) {
    const { rand, ink, clay, accent } = c;
    // Short ink "words" give the caret a line to sit in.
    scene.fill(roundRect(250, 336, 250, 38, 16, rand, 4), ink);
    scene.fill(roundRect(250, 480, 150, 38, 16, rand, 4), ink); // active line, ending at the caret
    scene.fill(roundRect(250, 624, 210, 38, 16, rand, 4), ink);
    scene.fill(roundRect(542, 624, 110, 38, 16, rand, 4), ink);
    // The caret itself: a tall bar capped with serifs, blinking in the accent.
    const cx = 452;
    scene.fill(roundRect(cx - 16, 420, 32, 158, 10, rand, 5), accent ? clay : ink);
    scene.fill(roundRect(cx - 52, 420, 104, 28, 12, rand, 3), accent ? clay : ink);
    scene.fill(roundRect(cx - 52, 550, 104, 28, 12, rand, 3), accent ? clay : ink);
  },

  // A file folder with a tab and a lighter front panel.
  folder(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(202, 300, 300, 130, 30, rand, 6), ink);
    scene.fill(roundRect(188, 360, 624, 402, 44, rand, 6), ink);
    scene.fill(roundRect(232, 442, 536, 288, 34, rand, 5), accent ? clay : paper);
  },

  // A dog-eared page with text lines — a document.
  document(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const page: Point[] = [[282, 198], [636, 198], [742, 304], [742, 802], [282, 802]];
    scene.fill(poly(page.map((p) => jit(p, rand, 4))), ink);
    const fold: Point[] = [[636, 198], [742, 304], [636, 304]];
    scene.fill(poly(fold.map((p) => jit(p, rand, 3))), paper);
    const ys = [386, 458, 530, 602, 674];
    const ws = [372, 372, 300, 372, 220];
    for (let i = 0; i < ys.length; i++) {
      scene.fill(roundRect(332, ys[i], ws[i], 28, 12, rand, 3), accent && i === ys.length - 1 ? clay : paper);
    }
  },

  // A version-control graph: a trunk of commits with a branch off and back.
  commit(scene, c) {
    const { rand, ink, clay, accent } = c;
    const x = 380;
    scene.fill(ribbon([[x, 244], [x, 758]], 22, rand, 0.03), ink);
    scene.fill(ribbon([[x, 420], [560, 470], [624, 560], [560, 650], [x, 620]], [20, 20, 20, 20, 20], rand, 0.03), ink);
    for (const y of [300, 500, 700]) scene.fill(disc(x, y, 46, rand, 0.06), ink);
    scene.fill(disc(624, 560, 46, rand, 0.06), accent ? clay : ink);
  },

  // A beetle — the debugging mark.
  bug(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 522;
    for (const ly of [-70, 10, 90]) {
      scene.fill(ribbon([[cx - 130, cy + ly], [cx - 216, cy + ly + 40]], 12, rand, 0.05), ink);
      scene.fill(ribbon([[cx + 130, cy + ly], [cx + 216, cy + ly + 40]], 12, rand, 0.05), ink);
    }
    scene.fill(disc(cx, cy, 176, rand, 0.04, 16, 0.8, 1.18), ink);
    scene.fill(disc(cx, cy - 192, 64, rand, 0.06), ink);
    scene.fill(ribbon([[cx - 28, cy - 238], [cx - 66, cy - 302]], 10, rand, 0.05), ink);
    scene.fill(ribbon([[cx + 28, cy - 238], [cx + 66, cy - 302]], 10, rand, 0.05), ink);
    scene.fill(ribbon([[cx, cy - 152], [cx, cy + 160]], 8, rand, 0.03), paper);
    scene.fill(disc(cx - 72, cy - 30, 30, rand, 0.1), accent ? clay : paper);
    scene.fill(disc(cx + 72, cy + 70, 30, rand, 0.1), accent ? clay : paper);
  },

  // Three offset slabs — a stack / a queue of layers.
  stack(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Three sheets, back to front, each stepped out; the front one takes the accent.
    scene.fill(roundRect(270, 330, 460, 128, 28, rand, 6), ink);
    scene.fill(roundRect(250, 468, 500, 128, 28, rand, 6), ink);
    scene.fill(roundRect(230, 606, 540, 128, 28, rand, 6), accent ? clay : ink);
    // A paper label strip on each sheet so the stack reads as bound cards, not bars.
    scene.fill(roundRect(300, 378, 180, 22, 11, rand, 3), paper);
    scene.fill(roundRect(280, 516, 200, 22, 11, rand, 3), paper);
    scene.fill(roundRect(260, 654, 220, 22, 11, rand, 3), paper);
  },

  // A cloud with a hint of rain — cloud / remote.
  cloud(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(roundRect(250, 498, 520, 150, 75, rand, 5), ink);
    scene.fill(disc(360, 500, 110, rand, 0.05), ink);
    scene.fill(disc(512, 438, 142, rand, 0.05), ink);
    scene.fill(disc(652, 500, 116, rand, 0.05), ink);
    if (accent) for (const dx of [-90, 0, 90]) scene.fill(disc(500 + dx, 706, 26, rand, 0.1), clay);
  },

  // --- human body motifs ----------------------------------------------------
  // The body and its parts, drawn as flat anatomical silhouettes.

  // A standing figure — person / profile / avatar.
  person(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(disc(500, 320, 120, rand, 0.04), accent ? clay : ink);
    const body: Point[] = [[500, 468], [590, 500], [648, 560], [672, 760], [328, 760], [352, 560], [410, 500]];
    scene.fill(closedSpline(body.map((p) => jit(p, rand, 6))), ink);
    // A paper collar carved at the neckline gives the torso a bit of form.
    const collar: Point[] = [[440, 486], [500, 556], [560, 486]];
    scene.fill(poly(collar.map((p) => jit(p, rand, 4))), paper);
  },

  // An open hand — palm, four fingers, a thumb.
  hand(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(roundRect(360, 440, 280, 260, 70, rand, 6), ink);
    const fx = [388, 452, 516, 580];
    const fh = [200, 240, 230, 190];
    for (let i = 0; i < 4; i++) scene.fill(roundRect(fx[i], 460 - fh[i], 48, fh[i] + 30, 24, rand, 4), ink);
    scene.fill(ribbon([[362, 560], [300, 496], [300, 436]], [36, 30, 26], rand, 0.04), ink);
    if (accent) scene.fill(disc(500, 582, 44, rand, 0.06), clay);
  },

  // A footprint — sole and toes.
  foot(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const sole: Point[] = [[470, 300], [560, 322], [602, 470], [560, 640], [500, 722], [430, 700], [398, 560], [400, 420]];
    scene.fill(closedSpline(sole.map((p) => jit(p, rand, 6))), ink);
    // A paper arch carved along the instep — the hollow of the sole.
    scene.fill(ribbon([[452, 400], [420, 520], [452, 640]], [14, 22, 12], rand, 0.05), paper);
    const toes: Point[] = [[520, 250], [578, 268], [612, 320], [626, 380]];
    const tr = [40, 32, 28, 24];
    for (let i = 0; i < toes.length; i++) {
      scene.fill(disc(toes[i][0], toes[i][1], tr[i], rand, 0.08), accent && i === 0 ? clay : ink);
    }
  },

  // A dog-bone.
  bone(scene, c) {
    const { rand, ink, clay, accent } = c;
    const A: Point = [320, 680];
    const B: Point = [680, 320];
    scene.fill(ribbon([A, B], 46, rand, 0.03), ink);
    scene.fill(disc(A[0] - 34, A[1] - 6, 66, rand, 0.06), ink);
    scene.fill(disc(A[0] + 6, A[1] + 34, 66, rand, 0.06), ink);
    scene.fill(disc(B[0] + 34, B[1] + 6, 66, rand, 0.06), accent ? clay : ink);
    scene.fill(disc(B[0] - 6, B[1] - 34, 66, rand, 0.06), accent ? clay : ink);
  },

  // A ribcage — spine and curved ribs.
  ribcage(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    scene.fill(ribbon([[cx, 250], [cx, 505], [cx, 760]], [24, 20, 16], rand, 0.03), ink);
    const levels = [332, 402, 472, 542];
    for (let i = 0; i < levels.length; i++) {
      const y = levels[i];
      const reach = 150 + i * 26;
      scene.fill(ribbon([[cx + 18, y], [cx + reach, y + 30], [cx + reach - 30, y + 112]], [16, 16, 14], rand, 0.03), ink);
      scene.fill(ribbon([[cx - 18, y], [cx - reach, y + 30], [cx - reach + 30, y + 112]], [16, 16, 14], rand, 0.03), ink);
    }
    scene.fill(disc(cx, 250, 34, rand, 0.06), accent ? clay : ink);
  },

  // Two lungs, a trachea, and the bronchi.
  lungs(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    scene.fill(ribbon([[cx, 252], [cx, 420]], [26, 22], rand, 0.03), ink);
    scene.fill(disc(cx, 250, 40, rand, 0.06), accent ? clay : ink);
    scene.fill(ribbon([[cx, 400], [cx - 70, 470]], [18, 14], rand, 0.03), ink);
    scene.fill(ribbon([[cx, 400], [cx + 70, 470]], [18, 14], rand, 0.03), ink);
    const lobeL: Point[] = [[cx - 80, 460], [cx - 70, 600], [cx - 150, 720], [cx - 250, 660], [cx - 262, 520], [cx - 190, 452]];
    const lobeR: Point[] = lobeL.map((p) => [1000 - p[0], p[1]] as Point);
    scene.fill(closedSpline(lobeL.map((p) => jit(p, rand, 6))), ink);
    scene.fill(closedSpline(lobeR.map((p) => jit(p, rand, 6))), ink);
  },

  // A molar with two roots and a shine.
  tooth(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const t: Point[] = [[cx - 140, 340], [cx - 90, 300], [cx + 90, 300], [cx + 140, 340], [cx + 150, 480], [cx + 110, 720], [cx, 540], [cx - 110, 720], [cx - 150, 480]];
    scene.fill(closedSpline(t.map((p) => jit(p, rand, 5))), ink);
    if (accent) scene.fill(closedSpline(starPts(cx - 58, 402, 4, 46, 14, rand, 0.05)), clay);
  },

  // A flexed arm — strength.
  muscle(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(ribbon([[300, 600], [500, 600]], 68, rand, 0.03), ink);
    scene.fill(ribbon([[500, 600], [540, 450], [540, 320]], [64, 58, 52], rand, 0.03), ink);
    scene.fill(disc(460, 540, 86, rand, 0.05), ink);
    scene.fill(disc(540, 300, 82, rand, 0.05), ink);
    if (accent) scene.fill(disc(460, 540, 40, rand, 0.08), clay);
  },

  // A heartbeat trace with a heart — vitals / pulse.
  pulse(scene, c) {
    const { rand, ink, clay, accent } = c;
    const trace: Point[] = [[170, 520], [360, 520], [430, 520], [470, 380], [520, 680], [575, 440], [620, 520], [830, 520]];
    scene.fill(ribbon(trace, 18, rand, 0.02), ink);
    scene.fill(closedSpline(heartPts(500, 250, 0.42).map((p) => jit(p, rand, 4))), accent ? clay : ink);
  },

  // A kidney bean with a hilum.
  kidney(scene, c) {
    const { rand, ink, clay, accent } = c;
    const k: Point[] = [[500, 280], [600, 340], [624, 440], [560, 500], [624, 560], [600, 660], [500, 720], [400, 660], [380, 500], [400, 340]];
    scene.fill(closedSpline(k.map((p) => jit(p, rand, 6))), ink);
    if (accent) scene.fill(disc(596, 500, 44, rand, 0.06), clay);
  },

  // --- AI / machine-learning motifs -----------------------------------------
  // The systems that learn and sense: circuits, neurons, nets, data, signals.

  // A chip pad with right-angle traces routed out to smaller pads.
  circuit(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const pads: Point[] = [[220, 260], [780, 260], [820, 520], [760, 780], [240, 780], [180, 520]];
    for (const [px, py] of pads) scene.fill(ribbon([[cx, cy], [px, cy], [px, py]], [14, 14, 14], rand, 0.02), ink);
    for (const p of pads) scene.fill(roundRect(p[0] - 32, p[1] - 32, 64, 64, 14, rand, 4), ink);
    scene.fill(roundRect(cx - 90, cy - 90, 180, 180, 24, rand, 6), ink);
    scene.fill(roundRect(cx - 44, cy - 44, 88, 88, 14, rand, 4), accent ? clay : paper);
  },

  // A neuron — soma with a nucleus, dendrites, and an axon to its terminals.
  neuron(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 420;
    const cy = 500;
    const dtips: Point[] = [[220, 320], [190, 462], [212, 600], [304, 300], [300, 700]];
    for (const t of dtips) {
      scene.fill(ribbon([[cx, cy], t], [16, 10], rand, 0.04), ink);
      scene.fill(disc(t[0], t[1], 22, rand, 0.09), ink);
    }
    scene.fill(disc(cx, cy, 96, rand, 0.06), ink);
    scene.fill(disc(cx, cy, 40, rand, 0.08), accent ? clay : paper);
    scene.fill(ribbon([[cx + 80, cy], [700, cy]], [20, 14], rand, 0.03), ink);
    const term: Point[] = [[782, 432], [802, 500], [782, 568]];
    for (const t of term) {
      scene.fill(ribbon([[700, cy], t], [12, 9], rand, 0.04), ink);
      scene.fill(disc(t[0], t[1], 20, rand, 0.09), accent ? clay : ink);
    }
  },

  // A small neural net — three layers of nodes, fully connected.
  layers(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cols = [260, 500, 740];
    const counts = [3, 4, 2];
    const layout: Point[][] = cols.map((x, ci) => {
      const n = counts[ci];
      const gap = 140;
      const start = 500 - ((n - 1) * gap) / 2;
      const pts: Point[] = [];
      for (let i = 0; i < n; i++) pts.push([x, start + i * gap]);
      return pts;
    });
    for (let ci = 0; ci < layout.length - 1; ci++) {
      for (const a of layout[ci]) for (const b of layout[ci + 1]) scene.fill(ribbon([a, b], 5, rand, 0.02), ink);
    }
    for (let ci = 0; ci < layout.length; ci++) {
      for (let j = 0; j < layout[ci].length; j++) {
        const isOut = accent && ci === 2 && j === 0;
        scene.fill(disc(layout[ci][j][0], layout[ci][j][1], 46, rand, 0.06), isOut ? clay : ink);
      }
    }
  },

  // A database cylinder with band lines and an accent lid.
  database(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const top = 286;
    const bot = 714;
    const rx = 196;
    const ry = 60;
    const ell = (y: number, col: string, r = rx): void => {
      scene.fill(disc(cx, y, r, rand, 0.02, 22, 1, ry / rx), col);
    };
    scene.fill(poly([[cx - rx, top], [cx + rx, top], [cx + rx, bot], [cx - rx, bot]]), ink);
    ell(bot, ink);
    for (const by of [top + 96, top + 186]) {
      ell(by, paper, rx * 0.97);
      ell(by + 12, ink, rx * 0.97);
    }
    ell(top, accent ? clay : ink);
  },

  // A grid of ones (bars) and zeros (rings) — binary / data.
  binary(scene, c) {
    const { rand, ink, clay, accent } = c;
    const start = 290;
    const gap = 140;
    const pattern = [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0];
    let k = 0;
    for (let r = 0; r < 4; r++) {
      for (let col = 0; col < 4; col++) {
        const x = start + col * gap;
        const y = start + r * gap;
        const color = accent && r === 1 && col === 2 ? clay : ink;
        if (pattern[k] === 1) scene.fill(roundRect(x - 16, y - 52, 32, 104, 14, rand, 3), color);
        else scene.fill(ring(x, y, 46, 24, rand, 0.05), color, "evenodd");
        k++;
      }
    }
  },

  // A sine wave between two nodes — a signal.
  signal(scene, c) {
    const { rand, ink, clay, accent } = c;
    const pts: Point[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = 180 + i * (640 / 40);
      const y = 500 - Math.sin((i / 40) * Math.PI * 4) * 150;
      pts.push([x, y]);
    }
    scene.fill(ribbon(pts, 16, rand, 0.01), ink);
    scene.fill(disc(180, 500, 40, rand, 0.06), accent ? clay : ink);
    scene.fill(disc(820, 500, 40, rand, 0.06), ink);
  },

  // A radar scope — rings, crosshairs, a sweep, and a blip.
  radar(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const cy = 520;
    for (const r of [120, 210, 300]) scene.fill(ring(cx, cy, r, r - 14, rand, 0.03), ink, "evenodd");
    scene.fill(ribbon([[cx - 300, cy], [cx + 300, cy]], 6, rand, 0.02), ink);
    scene.fill(ribbon([[cx, cy - 300], [cx, cy + 300]], 6, rand, 0.02), ink);
    const wedge: Point[] = [[cx, cy], [622, 246], [756, 362]];
    scene.fill(poly(wedge.map((p) => jit(p, rand, 4))), accent ? clay : ink);
    scene.fill(disc(cx, cy, 30, rand, 0.06), ink);
    scene.fill(disc(cx + 180, cy - 120, 34, rand, 0.08), ink);
  },

  // A hexagonal token with an accent core.
  token(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const R = 240;
    const hex: Point[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      hex.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    scene.fill(poly(hex.map((p) => jit(p, rand, 6))), ink);
    const inner: Point[] = hex.map((p) => [cx + (p[0] - cx) * 0.6, cy + (p[1] - cy) * 0.6] as Point);
    scene.fill(poly(inner.map((p) => jit(p, rand, 4))), paper);
    scene.fill(disc(cx, cy, 70, rand, 0.06), accent ? clay : ink);
  },

  // An eye framed by viewfinder brackets — machine vision.
  vision(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const L = 250;
    const R = 750;
    const T = 280;
    const B = 720;
    const len = 90;
    const corners: Point[][] = [
      [[L, T + len], [L, T], [L + len, T]],
      [[R - len, T], [R, T], [R, T + len]],
      [[R, B - len], [R, B], [R - len, B]],
      [[L + len, B], [L, B], [L, B - len]],
    ];
    for (const cr of corners) scene.fill(ribbon(cr, 22, rand, 0.02), ink);
    scene.fill(almond(cx, cy, 320, 190, 0, rand, 0.05), ink);
    scene.fill(disc(cx, cy, 66, rand, 0.06), paper);
    scene.fill(disc(cx, cy, 34, rand, 0.08), accent ? clay : ink);
  },

  // A compass — a ring, cardinal ticks, and a two-tone needle.
  compass(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    scene.fill(ring(cx, cy, 260, 224, rand, 0.03), ink, "evenodd");
    for (let a = 0; a < 4; a++) {
      const ang = (a * Math.PI) / 2 - Math.PI / 2;
      scene.fill(disc(cx + Math.cos(ang) * 196, cy + Math.sin(ang) * 196, 16, rand, 0.1), ink);
    }
    const nlen = 170;
    const north: Point[] = [[cx, cy - nlen], [cx - 46, cy], [cx + 46, cy]];
    const south: Point[] = [[cx, cy + nlen], [cx - 46, cy], [cx + 46, cy]];
    scene.fill(poly(south.map((p) => jit(p, rand, 4))), ink);
    scene.fill(poly(north.map((p) => jit(p, rand, 4))), accent ? clay : ink);
    scene.fill(disc(cx, cy, 34, rand, 0.06), ink);
  },

  // --- medicine motifs ------------------------------------------------------
  // Pharmacy and the clinic: pills, instruments, chemistry, care.

  // A two-tone capsule with a seam.
  pill(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const A: Point = [330, 670];
    const B: Point = [670, 330];
    const M: Point = [500, 500];
    scene.fill(ribbon([A, B], 96, rand, 0.02), ink);
    scene.fill(disc(A[0], A[1], 96, rand, 0.03), ink);
    scene.fill(ribbon([M, B], 96, rand, 0.02), accent ? clay : ink);
    scene.fill(disc(B[0], B[1], 96, rand, 0.03), accent ? clay : ink);
    scene.fill(ribbon([[453, 453], [547, 547]], 6, rand, 0.03), paper);
  },

  // A round tablet with a score line.
  tablet(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(disc(500, 500, 238, rand, 0.03), accent ? clay : ink);
    scene.fill(ribbon([[300, 500], [700, 500]], 14, rand, 0.02), paper);
  },

  // A syringe with a barrel of liquid, a plunger, and a needle.
  syringe(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const back: Point = [300, 700];
    const barA: Point = [402, 598];
    const barB: Point = [604, 396];
    const tip: Point = [716, 284];
    const perp: Point = [0.707, 0.707];
    scene.fill(ribbon([barB, tip], [10, 4], rand, 0.03), ink);
    scene.fill(ribbon([barA, barB], 46, rand, 0.02), ink);
    const mid: Point = [(barA[0] + barB[0]) / 2, (barA[1] + barB[1]) / 2];
    scene.fill(ribbon([mid, barB], 30, rand, 0.02), accent ? clay : paper);
    scene.fill(ribbon([back, barA], 14, rand, 0.03), ink);
    scene.fill(ribbon([[back[0] - perp[0] * 70, back[1] - perp[1] * 70], [back[0] + perp[0] * 70, back[1] + perp[1] * 70]], 16, rand, 0.03), ink);
    scene.fill(ribbon([[barA[0] - perp[0] * 60, barA[1] - perp[1] * 60], [barA[0] + perp[0] * 60, barA[1] + perp[1] * 60]], 14, rand, 0.03), ink);
  },

  // An Erlenmeyer flask with liquid and bubbles.
  flask(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const f: Point[] = [[440, 240], [560, 240], [560, 420], [700, 700], [300, 700], [440, 420]];
    scene.fill(poly(f.map((p) => jit(p, rand, 4))), ink);
    const liq: Point[] = [[360, 600], [640, 600], [700, 700], [300, 700]];
    scene.fill(poly(liq.map((p) => jit(p, rand, 3))), accent ? clay : paper);
    scene.fill(roundRect(430, 222, 140, 26, 10, rand, 3), paper);
    if (accent) {
      scene.fill(disc(470, 560, 20, rand, 0.1), paper);
      scene.fill(disc(542, 538, 14, rand, 0.1), paper);
    }
  },

  // A DNA double helix with base-pair rungs.
  dna(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const top = 240;
    const bot = 760;
    const amp = 150;
    const N = 64;
    const strandA: Point[] = [];
    const strandB: Point[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = top + (bot - top) * t;
      const ph = t * Math.PI * 3;
      strandA.push([cx + Math.sin(ph) * amp, y]);
      strandB.push([cx - Math.sin(ph) * amp, y]);
    }
    for (let i = 4; i < N; i += 8) {
      const t = i / N;
      const y = top + (bot - top) * t;
      const ph = t * Math.PI * 3;
      const isAcc = accent && Math.floor(i / 8) % 2 === 0;
      scene.fill(ribbon([[cx + Math.sin(ph) * amp, y], [cx - Math.sin(ph) * amp, y]], 9, rand, 0.03), isAcc ? clay : ink);
    }
    scene.fill(ribbon(strandA, 20, rand, 0.01), ink);
    scene.fill(ribbon(strandB, 20, rand, 0.01), ink);
  },

  // A medical cross with an ink border.
  cross(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const arm = 90;
    const len = 210;
    scene.fill(roundRect(cx - arm - 10, cy - len - 10, (arm + 10) * 2, (len + 10) * 2, 34, rand, 6), ink);
    scene.fill(roundRect(cx - len - 10, cy - arm - 10, (len + 10) * 2, (arm + 10) * 2, 34, rand, 6), ink);
    scene.fill(roundRect(cx - arm, cy - len, arm * 2, len * 2, 30, rand, 6), accent ? clay : paper);
    scene.fill(roundRect(cx - len, cy - arm, len * 2, arm * 2, 30, rand, 6), accent ? clay : paper);
  },

  // A stethoscope — ear tubes down to a chestpiece.
  stethoscope(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(ribbon([[360, 240], [390, 370], [500, 470]], [14, 16, 18], rand, 0.03), ink);
    scene.fill(ribbon([[640, 240], [610, 370], [500, 470]], [14, 16, 18], rand, 0.03), ink);
    scene.fill(disc(360, 232, 30, rand, 0.08), ink);
    scene.fill(disc(640, 232, 30, rand, 0.08), ink);
    scene.fill(ribbon([[500, 470], [500, 600], [560, 700]], [20, 20, 20], rand, 0.03), ink);
    scene.fill(disc(600, 722, 80, rand, 0.05), ink);
    scene.fill(disc(600, 722, 40, rand, 0.07), accent ? clay : paper);
  },

  // A microscope — base, arm, body tube, eyepiece, and stage.
  microscope(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(roundRect(300, 720, 400, 60, 30, rand, 5), ink);
    scene.fill(ribbon([[420, 720], [420, 560]], 40, rand, 0.02), ink);
    scene.fill(ribbon([[420, 560], [440, 420], [540, 340]], [40, 34, 30], rand, 0.03), ink);
    scene.fill(ribbon([[540, 340], [560, 240]], [30, 26], rand, 0.03), ink);
    scene.fill(roundRect(520, 196, 90, 60, 16, rand, 4), accent ? clay : ink);
    scene.fill(ribbon([[540, 360], [520, 440]], [22, 14], rand, 0.03), ink);
    scene.fill(roundRect(430, 470, 220, 34, 10, rand, 3), ink);
    if (accent) scene.fill(disc(520, 470, 20, rand, 0.1), clay);
  },

  // An adhesive bandage with a pad and perforations.
  bandage(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const A: Point = [300, 700];
    const B: Point = [700, 300];
    scene.fill(ribbon([A, B], 72, rand, 0.02), ink);
    scene.fill(disc(A[0], A[1], 72, rand, 0.03), ink);
    scene.fill(disc(B[0], B[1], 72, rand, 0.03), ink);
    const pad: Point[] = [[500, 410], [590, 500], [500, 590], [410, 500]];
    scene.fill(poly(pad.map((p) => jit(p, rand, 4))), accent ? clay : paper);
    for (const t of [0.22, 0.78]) {
      const x = A[0] + (B[0] - A[0]) * t;
      const y = A[1] + (B[1] - A[1]) * t;
      scene.fill(disc(x - 14, y - 14, 7, rand, 0.15), paper);
      scene.fill(disc(x + 14, y + 14, 7, rand, 0.15), paper);
    }
  },

  // A ball-and-stick molecule — a central atom bonded to three others.
  molecule(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const sat: Point[] = [[500, 260], [290, 620], [710, 620]];
    for (const s of sat) scene.fill(ribbon([[cx, cy], s], [20, 16], rand, 0.03), ink);
    for (let i = 0; i < sat.length; i++) scene.fill(disc(sat[i][0], sat[i][1], 70, rand, 0.05), accent && i === 0 ? clay : ink);
    scene.fill(disc(cx, cy, 100, rand, 0.05), ink);
    scene.fill(disc(cx, cy, 44, rand, 0.07), accent ? clay : paper);
  },

  // --- robot motifs ---------------------------------------------------------
  // Machines that move: heads, bodies, arms, and the parts that drive them.

  // A robot head with a face plate, eyes, mouth grille, and antenna.
  robot(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(ribbon([[500, 280], [500, 200]], 10, rand, 0.03), ink);
    scene.fill(disc(500, 188, 26, rand, 0.08), accent ? clay : ink);
    scene.fill(roundRect(270, 280, 460, 420, 60, rand, 6), ink);
    scene.fill(roundRect(320, 340, 360, 300, 40, rand, 4), paper);
    scene.fill(disc(420, 440, 44, rand, 0.06), accent ? clay : ink);
    scene.fill(disc(580, 440, 44, rand, 0.06), accent ? clay : ink);
    scene.fill(roundRect(380, 540, 240, 60, 16, rand, 3), ink);
    for (let i = 0; i < 4; i++) scene.fill(roundRect(398 + i * 56, 548, 20, 44, 6, rand, 2), paper);
  },

  // A full android body — head, torso, arms, and legs.
  android(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(410, 190, 180, 150, 36, rand, 5), ink);
    scene.fill(disc(460, 265, 20, rand, 0.08), accent ? clay : paper);
    scene.fill(disc(540, 265, 20, rand, 0.08), accent ? clay : paper);
    scene.fill(roundRect(470, 336, 60, 34, 10, rand, 2), ink);
    scene.fill(roundRect(360, 370, 280, 260, 40, rand, 6), ink);
    scene.fill(roundRect(430, 420, 140, 90, 16, rand, 3), accent ? clay : paper);
    scene.fill(ribbon([[360, 400], [290, 470], [300, 600]], [28, 26, 24], rand, 0.03), ink);
    scene.fill(ribbon([[640, 400], [710, 470], [700, 600]], [28, 26, 24], rand, 0.03), ink);
    scene.fill(disc(300, 612, 32, rand, 0.06), ink);
    scene.fill(disc(700, 612, 32, rand, 0.06), ink);
    scene.fill(ribbon([[440, 630], [440, 780]], 30, rand, 0.02), ink);
    scene.fill(ribbon([[560, 630], [560, 780]], 30, rand, 0.02), ink);
    scene.fill(roundRect(398, 782, 96, 34, 12, rand, 3), ink);
    scene.fill(roundRect(506, 782, 96, 34, 12, rand, 3), ink);
  },

  // An industrial robot arm — base, jointed segments, and a gripper.
  arm(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(roundRect(300, 720, 320, 60, 20, rand, 4), ink);
    scene.fill(disc(360, 720, 44, rand, 0.05), ink);
    scene.fill(ribbon([[360, 720], [420, 520]], [40, 34], rand, 0.03), ink);
    scene.fill(disc(420, 520, 40, rand, 0.05), accent ? clay : ink);
    scene.fill(ribbon([[420, 520], [640, 420]], [34, 28], rand, 0.03), ink);
    scene.fill(disc(640, 420, 34, rand, 0.05), ink);
    scene.fill(ribbon([[640, 420], [720, 360], [760, 380]], [16, 14, 12], rand, 0.03), ink);
    scene.fill(ribbon([[640, 420], [700, 320], [680, 290]], [16, 14, 12], rand, 0.03), ink);
  },

  // A two-finger gripper closing on an object.
  gripper(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(430, 240, 140, 80, 20, rand, 4), ink);
    scene.fill(ribbon([[500, 320], [500, 400]], 30, rand, 0.02), ink);
    scene.fill(disc(500, 410, 44, rand, 0.05), ink);
    scene.fill(ribbon([[470, 430], [380, 540], [420, 660]], [26, 22, 18], rand, 0.03), ink);
    scene.fill(ribbon([[530, 430], [620, 540], [580, 660]], [26, 22, 18], rand, 0.03), ink);
    scene.fill(disc(500, 600, 60, rand, 0.06), accent ? clay : paper);
  },

  // A wheeled rover with a camera mast and solar deck.
  rover(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(280, 440, 440, 180, 30, rand, 5), ink);
    scene.fill(roundRect(320, 470, 360, 60, 12, rand, 3), accent ? clay : paper);
    scene.fill(ribbon([[420, 440], [420, 300]], 16, rand, 0.03), ink);
    scene.fill(roundRect(380, 250, 120, 66, 16, rand, 3), ink);
    scene.fill(disc(440, 283, 22, rand, 0.07), accent ? clay : paper);
    for (const wx of [360, 500, 640]) {
      scene.fill(disc(wx, 640, 58, rand, 0.05), ink);
      scene.fill(disc(wx, 640, 24, rand, 0.08), paper);
    }
  },

  // A quadcopter drone — four ringed rotors and a camera body.
  drone(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const rot: Point[] = [[300, 300], [700, 300], [300, 700], [700, 700]];
    for (const r of rot) scene.fill(ribbon([[cx, cy], r], [18, 14], rand, 0.02), ink);
    for (let i = 0; i < rot.length; i++) {
      const [rx, ry] = rot[i];
      scene.fill(ring(rx, ry, 72, 58, rand, 0.05), ink);
      scene.fill(ribbon([[rx - 64, ry], [rx + 64, ry]], 8, rand, 0.03), accent && i === 0 ? clay : ink);
      scene.fill(disc(rx, ry, 14, rand, 0.08), ink);
    }
    scene.fill(roundRect(cx - 70, cy - 56, 140, 112, 26, rand, 5), ink);
    scene.fill(disc(cx, cy, 34, rand, 0.07), accent ? clay : paper);
  },

  // A broadcast tower emitting signal arcs.
  antenna(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const tipY = 300;
    const arc = (r: number, seg: number): Point[] => {
      const p: Point[] = [];
      const a0 = (200 * Math.PI) / 180;
      const a1 = (340 * Math.PI) / 180;
      for (let i = 0; i <= seg; i++) {
        const a = a0 + ((a1 - a0) * i) / seg;
        p.push([cx + Math.cos(a) * r, tipY + Math.sin(a) * r]);
      }
      return p;
    };
    const tower: Point[] = [[cx - 16, 782], [cx - 6, tipY + 8], [cx + 6, tipY + 8], [cx + 16, 782]];
    scene.fill(poly(tower.map((p) => jit(p, rand, 3))), ink);
    for (const y of [430, 540, 650, 750]) {
      const w = 14 + (y - tipY) * 0.03;
      scene.fill(ribbon([[cx - w, y - 26], [cx + w, y + 26]], 5, rand, 0.04), ink);
      scene.fill(ribbon([[cx - w, y + 26], [cx + w, y - 26]], 5, rand, 0.04), ink);
    }
    scene.fill(disc(cx, tipY, 24, rand, 0.07), ink);
    for (let k = 1; k <= 3; k++) scene.fill(ribbon(arc(50 + k * 44, 24), 8, rand, 0.03), accent && k === 1 ? clay : ink);
  },

  // A battery cell with charge bars and a terminal nub.
  battery(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(250, 340, 470, 320, 40, rand, 6), ink);
    scene.fill(roundRect(720, 420, 44, 160, 16, rand, 3), ink);
    scene.fill(roundRect(292, 382, 386, 236, 24, rand, 4), paper);
    for (let i = 0; i < 3; i++) scene.fill(roundRect(320 + i * 118, 414, 86, 172, 16, rand, 3), accent ? clay : ink);
  },

  // A sensor dome on a stalk casting detection rays.
  sensor(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(roundRect(420, 700, 160, 66, 16, rand, 3), ink);
    scene.fill(ribbon([[500, 700], [500, 560]], 22, rand, 0.02), ink);
    scene.fill(disc(500, 500, 90, rand, 0.05), ink);
    scene.fill(disc(500, 500, 50, rand, 0.06), accent ? clay : paper);
    scene.fill(disc(500, 500, 20, rand, 0.08), ink);
    for (const deg of [-40, -15, 15, 40]) {
      const a = ((deg - 90) * Math.PI) / 180;
      scene.fill(ribbon([[500 + Math.cos(a) * 100, 500 + Math.sin(a) * 100], [500 + Math.cos(a) * 210, 500 + Math.sin(a) * 210]], [8, 4], rand, 0.04), accent ? clay : ink);
    }
  },

  // A hex nut with a threaded hole.
  nut(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const hex: Point[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      hex.push([cx + Math.cos(a) * 270, cy + Math.sin(a) * 270]);
    }
    scene.fill(poly(hex.map((p) => jit(p, rand, 4))), accent ? clay : ink);
    scene.fill(ring(cx, cy, 150, 96, rand, 0.04), ink);
    scene.fill(disc(cx, cy, 96, rand, 0.05), paper);
  },

  // --- nature motifs --------------------------------------------------------
  // Sky, land, water and weather — a warmer, more organic counterpart to the
  // geometric systems set, still drawn as filled ink paths with a lone accent.

  // A sun: a ring of tapered rays around a solid face with an accent core.
  sun(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const tip: Point = [cx + Math.cos(a) * 434, cy + Math.sin(a) * 434];
      const b1: Point = [cx + Math.cos(a - 0.14) * 250, cy + Math.sin(a - 0.14) * 250];
      const b2: Point = [cx + Math.cos(a + 0.14) * 250, cy + Math.sin(a + 0.14) * 250];
      scene.fill(poly([tip, b1, b2].map((p) => jit(p, rand, 5))), ink);
    }
    scene.fill(disc(cx, cy, 256, rand, 0.04), ink);
    if (accent) scene.fill(disc(cx, cy, 158, rand, 0.05), clay);
  },

  // A crescent moon (a paper disc bites an ink one) with two sparks beside it.
  moon(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(disc(452, 500, 300, rand, 0.03), ink);
    scene.fill(disc(604, 452, 270, rand, 0.03), paper);
    scene.fill(poly(starPts(742, 706, 4, 56, 19, rand, 0.04)), accent ? clay : ink);
    scene.fill(poly(starPts(786, 388, 4, 34, 12, rand, 0.04)), ink);
  },

  // A two-peak mountain range with snow caps and an accent sun behind.
  mountain(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    if (accent) scene.fill(disc(720, 288, 96, rand, 0.05), clay);
    const range: Point[] = [[104, 806], [360, 300], [520, 520], [664, 356], [896, 806]];
    scene.fill(poly(range.map((p) => jit(p, rand, 6))), ink);
    const cap1: Point[] = [[320, 374], [360, 300], [404, 372], [386, 352], [362, 378], [340, 356]];
    scene.fill(poly(cap1.map((p) => jit(p, rand, 3))), paper);
    const cap2: Point[] = [[628, 420], [664, 356], [706, 420], [688, 402], [666, 428], [646, 404]];
    scene.fill(poly(cap2.map((p) => jit(p, rand, 3))), paper);
  },

  // A round-canopied tree: an ink trunk under a lumpy crown with accent fruit.
  tree(scene, c) {
    const { rand, ink, clay, accent } = c;
    scene.fill(roundRect(466, 556, 68, 320, 22, rand, 6), ink);
    scene.fill(disc(500, 402, 244, rand, 0.1, 20), ink);
    scene.fill(disc(356, 476, 150, rand, 0.1, 18), ink);
    scene.fill(disc(650, 470, 158, rand, 0.1, 18), ink);
    if (accent) {
      scene.fill(disc(430, 372, 30, rand, 0.08), clay);
      scene.fill(disc(566, 448, 30, rand, 0.08), clay);
      scene.fill(disc(500, 300, 30, rand, 0.08), clay);
    }
  },

  // A flame: an ink body cradling a hotter accent core.
  flame(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const outer: Point[] = [
      [500, 168], [572, 336], [636, 452], [648, 574], [592, 690],
      [500, 792], [408, 690], [352, 574], [364, 452], [428, 336],
    ];
    scene.fill(closedSpline(outer.map((p) => jit(p, rand, 6))), ink);
    const inner: Point[] = [
      [500, 396], [556, 500], [560, 596], [500, 690], [440, 596], [444, 500],
    ];
    scene.fill(closedSpline(inner.map((p) => jit(p, rand, 5))), accent ? clay : paper);
  },

  // A water droplet with a paper glint.
  droplet(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const d: Point[] = [
      [500, 160], [604, 372], [688, 552], [636, 690], [500, 768],
      [364, 690], [312, 552], [396, 372],
    ];
    scene.fill(closedSpline(d.map((p) => jit(p, rand, 6))), accent ? clay : ink);
    scene.fill(disc(438, 566, 58, rand, 0.08, 12, 0.7, 1), paper);
  },

  // Three rolling water waves, the middle one an accent swell.
  wave(scene, c) {
    const { rand, ink, clay, accent } = c;
    const band = (y0: number, color: string): void => {
      const pts: Point[] = [];
      for (let x = 130; x <= 872; x += 42) {
        pts.push([x, y0 + Math.sin((x / 742) * TAU * 1.6) * 52]);
      }
      scene.fill(ribbon(pts, 30, rand, 0.02), color);
    };
    band(380, ink);
    band(520, accent ? clay : ink);
    band(660, ink);
  },

  // A ringed planet (the ring tucked behind) with a paper shine and two stars.
  planet(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    scene.fill(ellipseRing(500, 486, 424, 118, 46, -0.3, rand), ink, "evenodd");
    scene.fill(disc(500, 512, 238, rand, 0.04), accent ? clay : ink);
    scene.fill(disc(432, 446, 66, rand, 0.09), paper);
    scene.fill(poly(starPts(824, 300, 4, 40, 14, rand, 0.04)), ink);
    scene.fill(poly(starPts(184, 688, 4, 30, 10, rand, 0.04)), ink);
  },

  // A six-armed snowflake: a spoke with two branch pairs and an accent hub.
  snowflake(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const cy = 500;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU - Math.PI / 2;
      const tip: Point = [cx + Math.cos(a) * 366, cy + Math.sin(a) * 366];
      scene.fill(ribbon([[cx, cy], tip], [34, 12], rand, 0.02), ink);
      for (const s of [-1, 1]) {
        const bx = cx + Math.cos(a) * 214;
        const by = cy + Math.sin(a) * 214;
        const ba = a + s * 0.62;
        scene.fill(
          ribbon(
            [[bx, by], [bx + Math.cos(ba) * 116, by + Math.sin(ba) * 116]],
            [16, 6],
            rand,
            0.02,
          ),
          ink,
        );
        const ox = cx + Math.cos(a) * 300;
        const oy = cy + Math.sin(a) * 300;
        const oa = a + s * 0.7;
        scene.fill(
          ribbon(
            [[ox, oy], [ox + Math.cos(oa) * 72, oy + Math.sin(oa) * 72]],
            [12, 5],
            rand,
            0.02,
          ),
          ink,
        );
      }
    }
    scene.fill(disc(cx, cy, 66, rand, 0.06), ink);
    if (accent) scene.fill(disc(cx, cy, 34, rand, 0.08), clay);
  },

  // A rainbow: six concentric spectrum bands clipped to an arch, a cloud at
  // each foot. Always multicolour (like prism/atom), so it ignores the accent.
  rainbow(scene, c) {
    const { rand, ink, paper, palette } = c;
    const cx = 500;
    const cy = 656;
    const R = 430;
    const bw = 48;
    for (let i = 0; i < palette.length; i++) {
      scene.fill(disc(cx, cy, R - i * bw, rand, 0.02, 44), palette[i]);
    }
    scene.fill(disc(cx, cy, R - palette.length * bw, rand, 0.03, 30), paper);
    scene.fill(rectD(0, cy, 1000, 1000 - cy), paper);
    for (const fx of [cx - R + bw * 0.5, cx + R - bw * 0.5]) {
      scene.fill(disc(fx, cy, 78, rand, 0.12, 16), ink);
      scene.fill(disc(fx - 66, cy + 8, 54, rand, 0.12, 14), ink);
      scene.fill(disc(fx + 66, cy + 8, 54, rand, 0.12, 14), ink);
    }
  },

  // --- data motifs -----------------------------------------------------------
  // The metrics-and-evaluation register: charts and dials in the same flat,
  // geometric spirit as the systems set. Each reads a measurement — one bar,
  // slice, or reading carries the accent as the "value that matters".

  // A bar chart: four upright bars on an L-axis, the tallest lit in the accent.
  barchart(scene, c) {
    const { rand, ink, clay, accent } = c;
    const base = 768;
    scene.fill(ribbon([[232, 232], [232, base], [808, base]], 15, rand, 0.02), ink);
    const bars: Array<[number, number]> = [[286, 196], [420, 330], [554, 470], [688, 268]];
    bars.forEach(([x, h], i) => {
      scene.fill(roundRect(x, base - h, 104, h, 16, rand, 5), accent && i === 2 ? clay : ink);
    });
  },

  // A line chart: a plotted line climbing across an L-axis, a dot at each
  // reading, the final peak enlarged and lit in the accent.
  linechart(scene, c) {
    const { rand, ink, clay, accent } = c;
    const base = 768;
    scene.fill(ribbon([[232, 232], [232, base], [808, base]], 15, rand, 0.02), ink);
    const pts: Point[] = [[266, 640], [396, 548], [520, 596], [648, 424], [772, 306]];
    scene.fill(ribbon(pts, 16, rand, 0.04), ink);
    pts.forEach((p, i) => {
      const last = i === pts.length - 1;
      scene.fill(disc(p[0], p[1], last ? 46 : 30, rand, 0.06), last && accent ? clay : ink);
    });
  },

  // A pie chart: one ink round cut by a paper divider, with a single accent
  // wedge — the highlighted share of the whole.
  piechart(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 496;
    const cy = 496;
    const R = 300;
    scene.fill(disc(cx, cy, R, rand, 0.02, 40), ink);
    // The accent wedge, spanning 150deg..250deg.
    const wedge: Point[] = [[cx, cy]];
    for (let i = 0; i <= 16; i++) {
      const a = ((150 + (100 * i) / 16) * Math.PI) / 180;
      wedge.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
    }
    scene.fill(poly(wedge), accent ? clay : paper);
    // A paper divider at -30deg implies a second cut (three apparent slices).
    const d = (-30 * Math.PI) / 180;
    scene.fill(
      ribbon([[cx, cy], [cx + Math.cos(d) * (R + 6), cy + Math.sin(d) * (R + 6)]], [15, 7], rand, 0.02),
      paper,
    );
  },

  // A gauge: a semicircular dial with paper tick marks and a needle swung
  // toward the accent-lit reading.
  gauge(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const cx = 500;
    const cy = 632;
    const ro = 322;
    const ri = 214;
    const N = 24;
    const band: Point[] = [];
    for (let i = 0; i <= N; i++) {
      const a = Math.PI + (Math.PI * i) / N;
      band.push([cx + Math.cos(a) * ro, cy + Math.sin(a) * ro]);
    }
    for (let i = N; i >= 0; i--) {
      const a = Math.PI + (Math.PI * i) / N;
      band.push([cx + Math.cos(a) * ri, cy + Math.sin(a) * ri]);
    }
    scene.fill(poly(band), ink);
    for (const t of [0.16, 0.38, 0.62, 0.84]) {
      const a = Math.PI + Math.PI * t;
      scene.fill(
        ribbon([[cx + Math.cos(a) * ri, cy + Math.sin(a) * ri], [cx + Math.cos(a) * ro, cy + Math.sin(a) * ro]], [12, 8], rand, 0.02),
        paper,
      );
    }
    const an = Math.PI + Math.PI * 0.7; // the needle's swing
    scene.fill(
      ribbon([[cx, cy], [cx + Math.cos(an) * (ri - 12), cy + Math.sin(an) * (ri - 12)]], [30, 6], rand, 0.03),
      accent ? clay : ink,
    );
    scene.fill(disc(cx, cy, 52, rand, 0.05), ink);
    scene.fill(disc(cx, cy, 24, rand, 0.08), accent ? clay : paper);
  },

  // A histogram: a run of thin bars rising and falling into a distribution, the
  // modal (tallest, central) bin carrying the accent.
  histogram(scene, c) {
    const { rand, ink, clay, accent } = c;
    const base = 772;
    scene.fill(ribbon([[214, 214], [214, base], [812, base]], 15, rand, 0.02), ink);
    const heights = [96, 168, 262, 356, 424, 356, 262, 168, 96];
    heights.forEach((h, i) => {
      const x = 246 + i * 62;
      scene.fill(roundRect(x, base - h, 52, h, 8, rand, 4), accent && i === 4 ? clay : ink);
    });
  },

  // A funnel: four stacked bands narrowing downward, the converted output at the
  // neck lit in the accent.
  funnel(scene, c) {
    const { rand, ink, clay, accent } = c;
    const cx = 500;
    const bands: Array<[number, number, number, number]> = [
      [560, 470, 224, 328],
      [452, 362, 360, 464],
      [344, 254, 496, 600],
      [236, 150, 632, 736],
    ];
    bands.forEach(([tw, bw, ty, by], i) => {
      scene.fill(
        poly([[cx - tw / 2, ty], [cx + tw / 2, ty], [cx + bw / 2, by], [cx - bw / 2, by]]),
        accent && i === 3 ? clay : ink,
      );
    });
  },

  // A meter: a rounded track with an accent fill and a paper-cored knob — a
  // progress or level reading.
  meter(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const x = 176;
    const y = 430;
    const w = 648;
    const h = 140;
    const r = 70;
    scene.fill(
      roundRect(x, y, w, h, r, rand, 5) + " " + roundRect(x + 18, y + 18, w - 36, h - 36, r - 18, rand, 5),
      ink,
      "evenodd",
    );
    const fillW = Math.round((w - 36) * 0.62);
    scene.fill(roundRect(x + 18, y + 18, fillW, h - 36, r - 18, rand, 4), accent ? clay : ink);
    const kx = x + 18 + fillW;
    scene.fill(disc(kx, y + h / 2, 78, rand, 0.05), ink);
    scene.fill(disc(kx, y + h / 2, 34, rand, 0.08), paper);
  },

  // A trend line: a rising sparkline tipped with an accent arrowhead — growth,
  // up and to the right.
  trend(scene, c) {
    const { rand, ink, clay, accent } = c;
    const pts: Point[] = [[196, 636], [340, 548], [470, 598], [612, 452], [742, 330]];
    scene.fill(ribbon(pts, [16, 16, 16, 16, 10], rand, 0.04), ink);
    for (let i = 1; i < pts.length - 1; i++) {
      scene.fill(disc(pts[i][0], pts[i][1], 22, rand, 0.08), ink);
    }
    const tip = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    let dx = tip[0] - prev[0];
    let dy = tip[1] - prev[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    const nx = -dy;
    const ny = dx;
    const back = 66;
    const half = 52;
    const bx = tip[0] - dx * back;
    const by = tip[1] - dy * back;
    scene.fill(
      poly([[tip[0] + dx * 20, tip[1] + dy * 20], [bx + nx * half, by + ny * half], [bx - nx * half, by - ny * half]]),
      accent ? clay : ink,
    );
  },

  // A scatter plot: a loosely correlated field of dots on an L-axis, with an
  // accent trend line drawn through the cloud.
  scatterplot(scene, c) {
    const { rand, ink, clay, accent } = c;
    const base = 772;
    scene.fill(ribbon([[214, 214], [214, base], [812, base]], 15, rand, 0.02), ink);
    scene.fill(ribbon([[250, 660], [780, 300]], [14, 14], rand, 0.03), accent ? clay : ink);
    const dots: Point[] = [
      [292, 636], [352, 566], [402, 620], [470, 540], [520, 578], [560, 484],
      [618, 512], [664, 430], [712, 388], [742, 452], [430, 470],
    ];
    for (const d of dots) scene.fill(disc(d[0], d[1], 26, rand, 0.08), ink);
  },

  // A candlestick chart: five wicked candles stepping across an axis, one up
  // candle lit in the accent.
  candles(scene, c) {
    const { rand, ink, clay, accent } = c;
    const base = 792;
    scene.fill(ribbon([[214, 208], [214, base], [812, base]], 15, rand, 0.02), ink);
    const candles: Array<[number, number, number, number, number]> = [
      [300, 300, 560, 360, 500],
      [420, 250, 520, 300, 460],
      [540, 360, 640, 400, 580],
      [660, 220, 470, 260, 420],
      [770, 320, 600, 380, 540],
    ];
    candles.forEach(([x, wt, wb, bt, bb], i) => {
      scene.fill(ribbon([[x, wt], [x, wb]], [8, 8], rand, 0.02), ink);
      scene.fill(roundRect(x - 34, bt, 68, bb - bt, 10, rand, 4), accent && i === 3 ? clay : ink);
    });
  },

  // A balance scale: a level beam on a central post, a shallow pan slung from
  // each end — the classic figure for weighing, comparing, fairness, tradeoffs.
  // Appended at the end of the registry so adding it doesn't renumber the
  // accent cycle of the existing tiles (which keys off motif index).
  balance(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Plinth: a rounded foot with a short trapezoid pedestal up to the post.
    scene.fill(roundRect(392, 752, 216, 46, 14, rand, 5), ink);
    scene.fill(poly([[470, 682], [530, 682], [556, 752], [444, 752]]), ink);
    // Central post, tapering a touch as it climbs to the pivot.
    scene.fill(ribbon([[500, 748], [500, 470], [500, 274]], [16, 15, 12], rand, 0.02), ink);
    // The beam: a level bar across the top, a knob at each hanging end.
    scene.fill(ribbon([[214, 262], [500, 262], [786, 262]], 14, rand, 0.03), ink);
    scene.fill(disc(214, 262, 15, rand, 0.06), ink);
    scene.fill(disc(786, 262, 15, rand, 0.06), ink);
    // Two pans, each slung from the beam by a pair of cords into a shallow bowl.
    for (const cx of [214, 786]) {
      scene.fill(ribbon([[cx, 270], [cx - 46, 486]], 3.5, rand, 0.02), ink);
      scene.fill(ribbon([[cx, 270], [cx + 46, 486]], 3.5, rand, 0.02), ink);
      scene.fill(ribbon([[cx - 54, 486], [cx, 520], [cx + 54, 486]], 9, rand, 0.03), ink);
    }
    // Pivot: the fulcrum knob, capped with an accent dot where the beam balances.
    scene.fill(disc(500, 264, 24, rand, 0.05), ink);
    scene.fill(disc(500, 264, 10, rand, 0.1), accent ? clay : paper);
  },

  // A blocky clay creature: a chunky slab of a body with stubby arms, little
  // stumpy legs, and a friendly kaomoji `< >` stare. The body carries the clay
  // when the accent is on (ink when monochrome); the eyes read either way.
  golem(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    const body = accent ? clay : ink;
    const eye = accent ? ink : paper;
    // Arms first, so the torso's edge tucks over their inner ends.
    scene.fill(roundRect(250, 372, 78, 96, 22, rand, 4), body);
    scene.fill(roundRect(672, 372, 78, 96, 22, rand, 4), body);
    // A small raised head-block sitting on top of the torso.
    scene.fill(roundRect(392, 266, 216, 78, 22, rand, 5), body);
    // Torso: the big blocky slab.
    scene.fill(roundRect(312, 322, 376, 300, 26, rand, 6), body);
    // Legs: four stumps hanging off the base, background showing between them.
    for (const x of [352, 436, 520, 604]) {
      scene.fill(roundRect(x, 604, 54, 96, 12, rand, 3), body);
    }
    // Eyes: a chevron facing inward on each side — the `< >` kaomoji stare.
    scene.fill(ribbon([[454, 372], [420, 404], [454, 436]], 11, rand, 0.03), eye);
    scene.fill(ribbon([[546, 372], [580, 404], [546, 436]], 11, rand, 0.03), eye);
  },

  // A friendly little alien: a domed head with big accent eyes, an open smile,
  // a bobbing antenna, and one arm raised mid-wave. Original — not any brand
  // mascot; just the generic wide-eyed-visitor trope in the house style.
  alien(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Antenna: a slim stalk curving up from the crown to a round bobble.
    scene.fill(ribbon([[506, 250], [520, 196], [548, 152]], [8, 6, 5], rand, 0.04), ink);
    scene.fill(disc(552, 148, 28, rand, 0.06), ink);
    // Body: a rounded torso with two stubby legs, tucked under the head.
    scene.fill(roundRect(432, 566, 136, 190, 54, rand, 6), ink);
    scene.fill(roundRect(452, 726, 40, 74, 16, rand, 3), ink);
    scene.fill(roundRect(508, 726, 40, 74, 16, rand, 3), ink);
    // One arm raised in a wave, the other resting down.
    scene.fill(ribbon([[556, 604], [648, 560], [702, 494]], [24, 18, 13], rand, 0.04), ink);
    scene.fill(disc(704, 490, 27, rand, 0.06), ink);
    scene.fill(ribbon([[440, 612], [408, 692]], [22, 15], rand, 0.04), ink);
    // Head: a big rounded dome with two little side bumps behind it.
    scene.fill(disc(322, 384, 46, rand, 0.05), ink);
    scene.fill(disc(678, 384, 46, rand, 0.05), ink);
    scene.fill(disc(500, 388, 182, rand, 0.04, 26, 1, 1.06), ink);
    // Open smile: a wide paper mouth low on the face.
    scene.fill(disc(500, 472, 62, rand, 0.05, 22, 1.15, 0.5), paper);
    // Eyes: two big accent discs, each with a paper glint.
    scene.fill(disc(436, 372, 48, rand, 0.05), accent ? clay : paper);
    scene.fill(disc(564, 372, 48, rand, 0.05), accent ? clay : paper);
    scene.fill(disc(452, 356, 15, rand, 0.1), paper);
    scene.fill(disc(580, 356, 15, rand, 0.1), paper);
  },

  // An octopus: a big domed mantle with two accent eyes and a fan of curling,
  // tapering tentacles. Original and generic — a plain cephalopod, no hybrid.
  octopus(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Tentacles: a fan of tapering arms curling out from under the mantle.
    const arms: Point[][] = [
      [[300, 560], [250, 660], [286, 752], [232, 820]],
      [[372, 588], [332, 700], [372, 792], [330, 858]],
      [[452, 604], [436, 720], [468, 812], [430, 872]],
      [[548, 604], [564, 720], [532, 812], [570, 872]],
      [[628, 588], [668, 700], [628, 792], [670, 858]],
      [[700, 560], [750, 660], [714, 752], [768, 820]],
    ];
    for (const a of arms) scene.fill(ribbon(a, [40, 28, 18, 7], rand, 0.03), ink);
    // Mantle: the big rounded head-body over the tentacle roots.
    scene.fill(disc(500, 400, 210, rand, 0.04, 26, 1.04, 1), ink);
    // A small paper smile.
    scene.fill(disc(500, 474, 40, rand, 0.06, 18, 1.2, 0.55), paper);
    // Eyes: two accent discs with paper glints.
    scene.fill(disc(432, 388, 52, rand, 0.05), accent ? clay : paper);
    scene.fill(disc(568, 388, 52, rand, 0.05), accent ? clay : paper);
    scene.fill(disc(448, 372, 16, rand, 0.1), paper);
    scene.fill(disc(584, 372, 16, rand, 0.1), paper);
  },

  // A tall ship: a curved hull under a mast carrying two billowing sails, an
  // accent mainsail, a pennant, and a waterline swell.
  ship(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Mast, then the two sails so they sit over it.
    scene.fill(ribbon([[506, 232], [506, 690]], [11, 11], rand, 0.02), ink);
    // Foresail: a smaller sail bellying to the left of the mast.
    const foresail: Point[] = [[488, 300], [300, 556], [396, 636], [488, 632]];
    scene.fill(closedSpline(foresail.map((p) => jit(p, rand, 6))), ink);
    // Mainsail: the big sail to the right, the lone accent when lit.
    const mainsail: Point[] = [[524, 276], [718, 470], [648, 636], [524, 648]];
    scene.fill(closedSpline(mainsail.map((p) => jit(p, rand, 6))), accent ? clay : ink);
    // A pennant streaming from the masthead.
    const pennant: Point[] = [[506, 232], [506, 286], [604, 258]];
    scene.fill(poly(pennant.map((p) => jit(p, rand, 4))), ink);
    // Hull: a smooth boat body with a paper deck stripe.
    const hull: Point[] = [[248, 688], [762, 688], [712, 744], [560, 798], [452, 798], [292, 744]];
    scene.fill(closedSpline(hull.map((p) => jit(p, rand, 6))), ink);
    scene.fill(ribbon([[286, 706], [724, 706]], [10, 10], rand, 0.03), paper);
    // A pair of waterline swells under the hull.
    scene.fill(ribbon([[176, 838], [372, 812], [560, 838], [824, 812]], 16, rand, 0.02), ink);
  },

  // A simple rowboat: a hollow crescent hull with a single oar and an accent
  // buoy, riding a low swell.
  boat(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Waterline first so the hull sits on it.
    scene.fill(ribbon([[150, 720], [360, 700], [560, 726], [850, 702]], 16, rand, 0.02), ink);
    // The oar, angled across the deck, blade to the upper right.
    scene.fill(ribbon([[512, 616], [806, 402]], [16, 24], rand, 0.03), ink);
    scene.fill(disc(812, 392, 60, rand, 0.06, 14, 1, 0.72), accent ? clay : ink);
    // Hull: a banana-shaped body, hollowed by a paper inner crescent.
    const outer: Point[] = [[196, 566], [500, 540], [804, 566], [716, 664], [500, 704], [284, 664]];
    scene.fill(closedSpline(outer.map((p) => jit(p, rand, 6))), ink);
    const inner: Point[] = [[286, 578], [500, 560], [714, 578], [648, 636], [500, 664], [352, 636]];
    scene.fill(closedSpline(inner.map((p) => jit(p, rand, 5))), paper);
  },

  // A lighthouse: a tapered striped tower topped by a lantern room throwing an
  // accent beam, standing on a rocky base.
  lighthouse(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Twin beams fanning from the lantern (drawn first, behind the tower).
    if (accent) {
      const beamR: Point[] = [[500, 232], [872, 150], [872, 314]];
      const beamL: Point[] = [[500, 232], [128, 150], [128, 314]];
      scene.fill(poly(beamR.map((p) => jit(p, rand, 5))), clay);
      scene.fill(poly(beamL.map((p) => jit(p, rand, 5))), clay);
    }
    // Tower: a trapezoid, wider at the base.
    const tower: Point[] = [[430, 322], [570, 322], [614, 766], [386, 766]];
    scene.fill(poly(tower.map((p) => jit(p, rand, 5))), ink);
    // Two paper bands crossing the tower (the lighthouse stripes).
    scene.fill(poly([[452, 430], [548, 430], [556, 512], [444, 512]]), paper);
    scene.fill(poly([[430, 596], [570, 596], [582, 682], [418, 682]]), paper);
    // Lantern room + a paper window, the light itself an accent core.
    scene.fill(roundRect(436, 238, 128, 92, 14, rand, 5), ink);
    scene.fill(disc(500, 284, 40, rand, 0.06), accent ? clay : paper);
    // A rocky base grounding the tower.
    const rocks: Point[] = [[300, 760], [500, 738], [700, 760], [800, 838], [500, 872], [200, 838]];
    scene.fill(closedSpline(rocks.map((p) => jit(p, rand, 8))), ink);
  },

  // An anchor: a ring over a shank crossed by a stock, ending in two flukes,
  // with an accent shackle.
  anchor(scene, c) {
    const { rand, ink, paper, clay, accent } = c;
    // Shank: the long central spine.
    scene.fill(ribbon([[500, 250], [500, 706]], [24, 24], rand, 0.02), ink);
    // Ring at the top, with an accent shackle disc through it.
    scene.fill(ring(500, 214, 76, 42, rand, 0.04), ink, "evenodd");
    if (accent) scene.fill(disc(500, 262, 28, rand, 0.08), clay);
    // Stock: the horizontal crossbar.
    scene.fill(ribbon([[388, 372], [612, 372]], [17, 17], rand, 0.02), ink);
    // Two curving arms sweeping up to barbed flukes.
    scene.fill(ribbon([[500, 690], [372, 700], [268, 596]], [22, 26], rand, 0.03), ink);
    scene.fill(ribbon([[500, 690], [628, 700], [732, 596]], [22, 26], rand, 0.03), ink);
    const flukeL: Point[] = [[268, 596], [232, 520], [330, 566]];
    const flukeR: Point[] = [[732, 596], [768, 520], [670, 566]];
    scene.fill(poly(flukeL.map((p) => jit(p, rand, 4))), ink);
    scene.fill(poly(flukeR.map((p) => jit(p, rand, 4))), ink);
    // A paper glint on the shank.
    scene.fill(disc(500, 470, 20, rand, 0.1, 12, 0.7, 1), paper);
  },
};

export const MOTIF_NAMES: string[] = Object.keys(MOTIFS);

// --- public API -------------------------------------------------------------

export interface IllustrateOptions {
  motif: string;
  size?: number; // rendered SVG width/height in px (viewBox stays 1000); default 1000
  accent?: boolean; // draw the accent shapes at all (default true)
  accentColor?: string; // which accent: a name (clay/red/blue/pink/yellow/green) or #rrggbb; default clay
  background?: Background; // paper (default), none (transparent), or ink
  seed?: number; // deterministic wobble seed (default 7)
  invert?: boolean; // tonal inverse: swap ink<->paper AND flip the backdrop (light-on-dark)
  roughness?: number; // hand-drawn wobble scale: 0 clean, 1 default, up to 4 loose
  weight?: number; // ink line-thickness scale for drawn strokes (0.2..4; default 1)
  sketch?: boolean; // preset for a looser, sketchier hand (roughness up, weight down)
  pose?: number; // per-seed framing variation: 0 off, 1 default, up to 2 (ignored when clean)
}

// A subtle, seed-stable "pose" for the whole motif: a small rotation, a slight
// shrink, and a little drift — so two seeds read as different hand-drawn TAKES
// of the same object rather than near-identical copies. The motif geometry is
// untouched; only its framing shifts. Scaled by `amt` (0 disables). Shrink-only
// and centered on the 1000-box so even a full-bleed motif never clips an edge.
function poseTransform(rand: () => number, amt: number): string {
  if (amt <= 0) return "";
  const rot = (rand() * 2 - 1) * 3.5 * amt; // degrees, +/-
  const sc = 1 - rand() * 0.1 * amt; // never scales up, so nothing spills out
  const tx = (rand() * 2 - 1) * 15 * amt;
  const ty = (rand() * 2 - 1) * 15 * amt;
  return (
    `translate(${num(tx)} ${num(ty)}) rotate(${num(rot)} 500 500) ` +
    `translate(500 500) scale(${num(sc)}) translate(-500 -500)`
  );
}

/**
 * Draw a built-in motif as an SVG string in the blog's flat, two-tone,
 * hand-inked style. Deterministic for a given (motif, seed).
 */
export function illustrate(opts: IllustrateOptions): string {
  const motif = MOTIFS[opts.motif];
  if (!motif) {
    throw new Error(
      `Unknown motif "${opts.motif}". Choose one of: ${MOTIF_NAMES.join(", ")}.`,
    );
  }
  const size = clampInt(opts.size ?? 1000, 64, 4000);
  const invert = opts.invert ?? false;
  const seed = (opts.seed ?? 7) | 0;
  const ctx: Ctx = {
    rand: makeRng(seed),
    ink: invert ? PAPER : INK,
    paper: invert ? INK : PAPER,
    clay: resolveAccent(opts.accentColor),
    palette: SPECTRUM,
    accent: opts.accent ?? true,
  };
  const scene = new Scene(1000, 1000);
  const style = resolveStyle(opts);
  withStyle(style, () => motif(scene, ctx));
  const background = flipBackground(opts.background ?? "paper", invert);
  // A clean render (roughness 0) stays canonical and seed-independent; any other
  // render gets a small seed-stable pose so each seed reads as a unique take. The
  // pose rides its own RNG stream, so the motif's own wobble is left untouched.
  const poseAmt = style.roughness === 0 ? 0 : clampNum(opts.pose ?? 1, 0, 2);
  const pose = poseTransform(makeRng((seed ^ 0x5bd1e995) | 0), poseAmt);
  const inner = scene.innerPaths();
  const body = pose && inner ? `<g transform="${pose}">\n${inner}\n</g>` : inner;
  return svgEnvelope(1000, 1000, size, size, background, body);
}

// --- composition ------------------------------------------------------------
// Place several motifs into one 1000x1000 scene. Each motif still draws in its
// own centered 1000-space; a <g transform> scales and positions it. This is how
// a single spot illustration becomes a plate of many.

export type Layout = "grid" | "row" | "column" | "scatter" | "focal";

export interface Placement {
  motif: string;
  x?: number; // center X in the scene's 1000-space (default 500)
  y?: number; // center Y (default 500)
  scale?: number; // 1 = a full-canvas motif; <1 shrinks it (default 1)
  rotate?: number; // degrees, about the motif's own center (default 0)
  accent?: boolean;
  accentColor?: string;
  seed?: number; // per-placement wobble seed (defaults off the scene seed)
}

export interface ComposeOptions {
  placements?: Placement[]; // explicit control, OR:
  motifs?: string[]; // a list auto-arranged by `layout`
  layout?: Layout; // default "grid"
  size?: number;
  background?: Background;
  seed?: number;
  invert?: boolean;
  accent?: boolean; // scene-wide default; a placement can override
  accentColor?: string; // scene-wide default; a placement can override
  roughness?: number;
  weight?: number;
  sketch?: boolean;
  pad?: number; // margin kept around each auto-laid cell, 0..0.9 (default 0.14)
}

// Arrange a flat list of motifs into placements for the chosen layout.
function autoPlacements(
  motifs: string[],
  layout: Layout,
  pad: number,
  rand: () => number,
): Placement[] {
  const n = motifs.length;
  if (n === 0) return [];
  let cols: number;
  let rows: number;
  if (layout === "row") {
    cols = n;
    rows = 1;
  } else if (layout === "column") {
    cols = 1;
    rows = n;
  } else {
    cols = Math.ceil(Math.sqrt(n)); // grid and scatter share a square-ish grid
    rows = Math.ceil(n / cols);
  }
  const cellW = 1000 / cols;
  const cellH = 1000 / rows;
  const fit = (Math.min(cellW, cellH) / 1000) * (1 - pad);
  const out: Placement[] = [];
  for (let i = 0; i < n; i++) {
    let x = ((i % cols) + 0.5) * cellW;
    let y = (Math.floor(i / cols) + 0.5) * cellH;
    let scale = fit;
    let rotate = 0;
    if (layout === "scatter") {
      x += (rand() * 2 - 1) * cellW * 0.16;
      y += (rand() * 2 - 1) * cellH * 0.16;
      scale = fit * (0.82 + rand() * 0.3);
      rotate = (rand() * 2 - 1) * 12;
    }
    out.push({ motif: motifs[i], x, y, scale, rotate });
  }
  return out;
}

// A composed "spot" arrangement rather than an even grid: the first motif is the
// hero — large and central — and the rest ring around it as smaller satellites,
// reaching toward the corners so the frame reads full. compose() links each
// satellite back to the hero with a thin spoke, so the plate reads as one
// connected idea (a subject and its facets) instead of a row of loose icons.
function focalPlacements(motifs: string[], rand: () => number): Placement[] {
  const n = motifs.length;
  if (n === 1) return [{ motif: motifs[0], x: 500, y: 500, scale: 0.86 }];

  const heroScale = n === 2 ? 0.62 : n === 3 ? 0.56 : 0.5;
  const hx = 500;
  const hy = 466; // a touch high, so the ring has room to ground the composition
  const out: Placement[] = [{ motif: motifs[0], x: hx, y: hy, scale: heroScale }];

  const sats = motifs.slice(1);
  const m = sats.length;
  const rx = 352;
  const ry = 322;
  // Balanced constellations for the common counts (screen degrees, 0 = right,
  // 90 = down). Several per count — a pyramid, its inverse, a flank, a diagonal —
  // one chosen per scene by the seed, so the wall doesn't settle into a single
  // silhouette. Angles are jittered too. Scenes carry 2-4 motifs, so m is 1-3.
  const RING_SETS: Record<number, number[][]> = {
    1: [[-40], [40], [150], [214]],
    2: [
      [150, 30],
      [210, 330],
      [174, 6],
      [130, 310],
    ],
    3: [
      [204, 336, 92],
      [156, 24, 268],
      [180, 300, 60],
      [220, 320, 90],
    ],
  };
  const sets = RING_SETS[m] ?? [Array.from({ length: m }, (_, k) => 200 + (k * 360) / m)];
  const degs = sets[Math.floor(rand() * sets.length) % sets.length];
  for (let k = 0; k < m; k++) {
    const ang = (degs[k] + (rand() * 2 - 1) * 11) * (Math.PI / 180);
    const sx = clampNum(hx + Math.cos(ang) * rx, 172, 828);
    const sy = clampNum(hy + Math.sin(ang) * ry, 156, 840);
    const scale = Math.max(
      0.26,
      (m === 1 ? 0.42 : 0.38) - k * 0.02 + (rand() * 2 - 1) * 0.02,
    );
    const rotate = (rand() * 2 - 1) * 7;
    out.push({ motif: sats[k], x: sx, y: sy, scale, rotate });
  }
  return out;
}

// The spokes for a focal plate: a thin tapered line from just outside the hero
// out to each satellite, tipped with a small node where it meets it. Returned as
// raw <path> markup to draw *under* the motifs, so the shapes sit on the joins.
function focalConnectors(
  placements: Placement[],
  ink: string,
  rand: () => number,
): string[] {
  if (placements.length < 2) return [];
  const hero = placements[0];
  const hx = hero.x ?? 500;
  const hy = hero.y ?? 500;
  const heroR = 500 * (hero.scale ?? 1) * 0.4;
  const out: string[] = [];
  for (let i = 1; i < placements.length; i++) {
    const p = placements[i];
    const px = p.x ?? 500;
    const py = p.y ?? 500;
    const dx = px - hx;
    const dy = py - hy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const satR = 500 * (p.scale ?? 1) * 0.52;
    const start: Point = [hx + ux * heroR, hy + uy * heroR];
    const end: Point = [px - ux * satR, py - uy * satR];
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 48) continue;
    out.push(`<path d="${ribbon([start, end], [12, 6], rand, 0.05)}" fill="${ink}"/>`);
    out.push(`<path d="${disc(end[0], end[1], 16, rand, 0.12)}" fill="${ink}"/>`);
  }
  return out;
}

/**
 * Compose several motifs into one SVG plate. Give explicit `placements`, or a
 * list of `motifs` plus a `layout` (grid/row/column/scatter/focal). Deterministic
 * for a given (options, seed).
 */
export function compose(opts: ComposeOptions): string {
  const size = clampInt(opts.size ?? 1000, 64, 4000);
  const invert = opts.invert ?? false;
  const baseSeed = (opts.seed ?? 7) | 0;
  const style = resolveStyle(opts);
  const pad = clampNum(opts.pad ?? 0.14, 0, 0.9);

  const layout = opts.layout ?? "grid";
  let placements: Placement[];
  if (opts.placements && opts.placements.length) {
    placements = opts.placements;
  } else if (opts.motifs && opts.motifs.length) {
    const layoutRand = makeRng((baseSeed ^ 0x9e3779b9) | 0);
    placements =
      layout === "focal"
        ? focalPlacements(opts.motifs, layoutRand)
        : autoPlacements(opts.motifs, layout, pad, layoutRand);
  } else {
    throw new Error("compose: provide `placements` or `motifs`.");
  }
  if (placements.length > 64) {
    throw new Error(`compose: too many placements (${placements.length}); the cap is 64.`);
  }

  const ink = invert ? PAPER : INK;
  const paper = invert ? INK : PAPER;
  const groups: string[] = [];
  for (let i = 0; i < placements.length; i++) {
    const pl = placements[i];
    const motif = MOTIFS[pl.motif];
    if (!motif) {
      throw new Error(
        `compose: unknown motif "${pl.motif}". Choose one of: ${MOTIF_NAMES.join(", ")}.`,
      );
    }
    const ctx: Ctx = {
      rand: makeRng(((pl.seed ?? baseSeed) + i * 1013) | 0),
      ink,
      paper,
      clay: resolveAccent(pl.accentColor ?? opts.accentColor),
      palette: SPECTRUM,
      accent: pl.accent ?? opts.accent ?? true,
    };
    const sub = new Scene(1000, 1000);
    withStyle(style, () => motif(sub, ctx));
    const inner = sub.innerPaths();
    if (!inner) continue;
    const s = pl.scale ?? 1;
    const x = pl.x ?? 500;
    const y = pl.y ?? 500;
    const rot = pl.rotate ? ` rotate(${num(pl.rotate)})` : "";
    // Read right-to-left: recenter the motif on the origin, rotate about it,
    // scale, then move its center to (x, y) in the scene.
    const tf = `translate(${num(x)} ${num(y)}) scale(${num(s)})${rot} translate(-500 -500)`;
    groups.push(`<g transform="${tf}">\n${inner}\n</g>`);
  }

  // Focal plates get spokes joining each satellite to the hero, drawn first so
  // the motifs sit on top of the joins.
  const connectors =
    layout === "focal"
      ? focalConnectors(placements, ink, makeRng((baseSeed ^ 0x517cc1b7) | 0))
      : [];

  const background = flipBackground(opts.background ?? "paper", invert);
  return svgEnvelope(
    1000,
    1000,
    size,
    size,
    background,
    [...connectors, ...groups].join("\n"),
  );
}

/** Rasterize an SVG string to a PNG buffer (for an inline preview). */
export async function rasterize(svg: string, width?: number): Promise<Buffer> {
  const img = sharp(Buffer.from(svg), { density: 200 });
  return (width ? img.resize({ width }) : img).png().toBuffer();
}
