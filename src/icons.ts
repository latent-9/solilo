// icons.ts — a small library of pictographic icons rendered as crisp braille
// line-art, in the flat, two-tone, hand-inked spirit of the Claude blog's
// "object" and "hand" spot illustrations (ink #141413 on cream #FAF9F5, the
// occasional clay #D97757 accent). Each icon is authored once as filled/stroked
// vector primitives on a high-resolution boolean bitmap, then downsampled to
// Unicode braille (2x4 dots per cell) — the same sub-pixel grid shape_text and
// image_to_braille use — so an icon stays sharp at any cell size. Filled shapes
// pack to solid cells (the inky silhouette look); strokes pack to fine lines.

const BRAILLE_BASE = 0x2800;
const BRAILLE_DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

type Point = [number, number];

// A high-resolution 1-bit bitmap with the handful of vector primitives the icon
// definitions need. All coordinates are in sub-pixel space (0..w, 0..h).
class Raster {
  readonly w: number;
  readonly h: number;
  private buf: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8Array(w * h);
  }

  set(x: number, y: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.buf[yi * this.w + xi] = 1;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.buf[y * this.w + x];
  }

  // Filled disk — the stamp behind every thick stroke (gives round caps).
  disk(cx: number, cy: number, r: number): void {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y);
      }
    }
  }

  // Thick segment: stamp disks of radius t/2 densely along the line.
  stroke(x0: number, y0: number, x1: number, y1: number, t: number): void {
    const r = Math.max(0.5, t / 2);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.5));
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      this.disk(x0 + dx * s, y0 + dy * s, r);
    }
  }

  // Circle outline of thickness t (an annulus).
  ring(cx: number, cy: number, r: number, t: number): void {
    const rr = Math.max(0.5, t / 2);
    const steps = Math.max(12, Math.ceil((2 * Math.PI * r) / 0.5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      this.disk(cx + r * Math.cos(a), cy + r * Math.sin(a), rr);
    }
  }

  // Arc from a0 to a1 (radians), thickness t.
  arc(cx: number, cy: number, r: number, a0: number, a1: number, t: number): void {
    const rr = Math.max(0.5, t / 2);
    const span = a1 - a0;
    const steps = Math.max(4, Math.ceil((Math.abs(span) * r) / 0.5));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + span * (i / steps);
      this.disk(cx + r * Math.cos(a), cy + r * Math.sin(a), rr);
    }
  }

  // Even-odd scanline polygon fill.
  fillPoly(pts: Point[]): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const xs: number[] = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const yi = pts[i][1];
        const yj = pts[j][1];
        if (yi > y !== yj > y) {
          const xi = pts[i][0];
          const xj = pts[j][0];
          xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k]);
        const xb = Math.floor(xs[k + 1]);
        for (let x = xa; x <= xb; x++) this.set(x, y);
      }
    }
  }

  // Connected thick strokes; `closed` joins the last point back to the first.
  strokePoly(pts: Point[], t: number, closed: boolean): void {
    for (let i = 0; i + 1 < pts.length; i++)
      this.stroke(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], t);
    if (closed && pts.length > 1) {
      const a = pts[pts.length - 1];
      const b = pts[0];
      this.stroke(a[0], a[1], b[0], b[1], t);
    }
  }
}

// The icon-authoring surface: every method takes normalized coordinates in the
// unit square [0,1] x [0,1] (y points down) and normalized lengths (fractions of
// the icon's short side), so an icon reads the same at any render size. Omitting
// a thickness uses the weight-scaled default.
interface Pen {
  line(x0: number, y0: number, x1: number, y1: number, t?: number): void;
  poly(pts: Point[], t?: number, closed?: boolean): void;
  fill(pts: Point[]): void;
  ring(cx: number, cy: number, r: number, t?: number): void;
  disk(cx: number, cy: number, r: number): void;
  arc(cx: number, cy: number, r: number, a0deg: number, a1deg: number, t?: number): void;
  rect(x: number, y: number, w: number, h: number, t?: number): void;
  box(x: number, y: number, w: number, h: number): void;
}

function makePen(r: Raster, weight: number): Pen {
  const W = r.w;
  const H = r.h;
  const unit = Math.min(W, H);
  const X = (nx: number): number => nx * (W - 1);
  const Y = (ny: number): number => ny * (H - 1);
  const S = (n: number): number => n * unit; // normalized length -> sub-pixels
  const defT = Math.max(0.9, unit * 0.05 * weight);
  const T = (tn?: number): number => (tn == null ? defT : Math.max(0.9, S(tn) * weight));
  const map = (pts: Point[]): Point[] => pts.map(([a, b]) => [X(a), Y(b)] as Point);
  return {
    line: (x0, y0, x1, y1, t) => r.stroke(X(x0), Y(y0), X(x1), Y(y1), T(t)),
    poly: (pts, t, closed = false) => r.strokePoly(map(pts), T(t), closed),
    fill: (pts) => r.fillPoly(map(pts)),
    ring: (cx, cy, rr, t) => r.ring(X(cx), Y(cy), S(rr), T(t)),
    disk: (cx, cy, rr) => r.disk(X(cx), Y(cy), S(rr)),
    arc: (cx, cy, rr, a0, a1, t) =>
      r.arc(X(cx), Y(cy), S(rr), (a0 * Math.PI) / 180, (a1 * Math.PI) / 180, T(t)),
    rect: (x, y, w, h, t) =>
      r.strokePoly(
        map([
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ]),
        T(t),
        true,
      ),
    box: (x, y, w, h) =>
      r.fillPoly(
        map([
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ]),
      ),
  };
}

// A regular n-point star centered at (cx, cy), tip pointing up.
function starPoints(cx: number, cy: number, outer: number, inner: number, n = 5): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const rad = i % 2 === 0 ? outer : inner;
    const ang = -Math.PI / 2 + (i * Math.PI) / n; // start at top
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  return pts;
}

// The icon set. Each draws itself into the unit square via the pen. Names and
// shapes echo the Claude blog's object/hand vocabulary plus broadly useful
// pictograms. Kept alphabetical for a stable ICON_NAMES export.
const ICONS: Record<string, (p: Pen) => void> = {
  // A mouse cursor / pointer arrow (filled).
  arrow: (p) => {
    p.fill([
      [0.30, 0.16],
      [0.30, 0.78],
      [0.44, 0.63],
      [0.54, 0.84],
      [0.63, 0.80],
      [0.53, 0.60],
      [0.72, 0.58],
    ]);
  },

  // A lightning bolt / spark (filled zigzag).
  bolt: (p) => {
    p.fill([
      [0.56, 0.10],
      [0.28, 0.56],
      [0.46, 0.56],
      [0.40, 0.90],
      [0.72, 0.42],
      [0.52, 0.42],
    ]);
  },

  // A brick wall: an outer wall with offset courses (Hand-BuildingBricks).
  bricks: (p) => {
    p.rect(0.14, 0.24, 0.72, 0.52, 0.03);
    const y1 = 0.24 + 0.52 / 3;
    const y2 = 0.24 + (2 * 0.52) / 3;
    p.line(0.14, y1, 0.86, y1, 0.03);
    p.line(0.14, y2, 0.86, y2, 0.03);
    // Vertical joints, offset every other course.
    p.line(0.38, 0.24, 0.38, y1, 0.03);
    p.line(0.62, 0.24, 0.62, y1, 0.03);
    p.line(0.26, y1, 0.26, y2, 0.03);
    p.line(0.50, y1, 0.50, y2, 0.03);
    p.line(0.74, y1, 0.74, y2, 0.03);
    p.line(0.38, y2, 0.38, 0.76, 0.03);
    p.line(0.62, y2, 0.62, 0.76, 0.03);
  },

  // A checkmark (thick stroke).
  check: (p) => {
    p.poly(
      [
        [0.22, 0.52],
        [0.42, 0.72],
        [0.80, 0.28],
      ],
      0.11,
    );
  },

  // A speech bubble with a tail and three dots (Object-CodeChatCode kin).
  chat: (p) => {
    p.rect(0.14, 0.20, 0.72, 0.42, 0.04);
    p.poly(
      [
        [0.30, 0.62],
        [0.24, 0.80],
        [0.46, 0.62],
      ],
      0.04,
    );
    p.disk(0.34, 0.41, 0.035);
    p.disk(0.50, 0.41, 0.035);
    p.disk(0.66, 0.41, 0.035);
  },

  // Code angle brackets < > (Object-CodeMagnifier / CodeChatCode kin).
  code: (p) => {
    p.poly(
      [
        [0.40, 0.24],
        [0.22, 0.50],
        [0.40, 0.76],
      ],
      0.07,
    );
    p.poly(
      [
        [0.60, 0.24],
        [0.78, 0.50],
        [0.60, 0.76],
      ],
      0.07,
    );
  },

  // An isometric cube / building block.
  cube: (p) => {
    const T: Point = [0.5, 0.12];
    const R: Point = [0.88, 0.33];
    const F: Point = [0.5, 0.54];
    const L: Point = [0.12, 0.33];
    const FB: Point = [0.5, 0.9];
    const LB: Point = [0.12, 0.69];
    const RB: Point = [0.88, 0.69];
    p.poly([T, R, F, L], 0.04, true); // top face
    p.line(F[0], F[1], FB[0], FB[1], 0.04); // front-center edge down
    p.line(L[0], L[1], LB[0], LB[1], 0.04);
    p.line(R[0], R[1], RB[0], RB[1], 0.04);
    p.line(FB[0], FB[1], LB[0], LB[1], 0.04);
    p.line(FB[0], FB[1], RB[0], RB[1], 0.04);
  },

  // A city skyline: solid buildings of varying height on a ground line
  // (Hand-City). Filled silhouettes read cleaner than outlines at small sizes.
  city: (p) => {
    const base = 0.82;
    const b: [number, number, number][] = [
      // [x, width, top]
      [0.12, 0.15, 0.46],
      [0.3, 0.13, 0.28],
      [0.46, 0.12, 0.54],
      [0.61, 0.16, 0.2],
      [0.8, 0.11, 0.4],
    ];
    for (const [x, w, top] of b) p.box(x, top, w, base - top);
    p.line(0.06, base, 0.94, base, 0.04);
  },

  // A cog / gear: radial teeth, a rim, and a hub hole.
  gear: (p) => {
    const cx = 0.5;
    const cy = 0.5;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      p.line(cx + 0.26 * dx, cy + 0.26 * dy, cx + 0.44 * dx, cy + 0.44 * dy, 0.09);
    }
    p.ring(cx, cy, 0.28, 0.09);
    p.ring(cx, cy, 0.1, 0.06);
  },

  // A heart (filled): two lobes over a triangle (Claude-warm).
  heart: (p) => {
    p.disk(0.34, 0.37, 0.18);
    p.disk(0.66, 0.37, 0.18);
    p.fill([
      [0.16, 0.42],
      [0.84, 0.42],
      [0.5, 0.84],
    ]);
  },

  // A key: a ring bow, a diagonal shaft, and two teeth.
  key: (p) => {
    p.ring(0.3, 0.3, 0.15, 0.07);
    p.line(0.4, 0.4, 0.8, 0.8, 0.07);
    p.line(0.66, 0.66, 0.58, 0.74, 0.06);
    p.line(0.74, 0.74, 0.66, 0.82, 0.06);
  },

  // A magnifying glass: a lens ring and a handle (Object-CodeMagnifier).
  magnifier: (p) => {
    p.ring(0.42, 0.42, 0.24, 0.06);
    p.line(0.6, 0.6, 0.86, 0.86, 0.1);
  },

  // A radiating burst / spark (on-brand sunburst).
  spark: (p) => {
    const cx = 0.5;
    const cy = 0.5;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * 2 * Math.PI;
      const long = k % 2 === 0;
      const len = long ? 0.4 : 0.26;
      p.line(cx, cy, cx + len * Math.cos(a), cy + len * Math.sin(a), long ? 0.06 : 0.045);
    }
    p.disk(cx, cy, 0.05);
  },

  // A five-point star (filled).
  star: (p) => {
    p.fill(starPoints(0.5, 0.52, 0.42, 0.17));
  },

  // A terminal / code window: a frame, a title bar, a prompt and a caret.
  terminal: (p) => {
    p.rect(0.14, 0.22, 0.72, 0.54, 0.04);
    p.line(0.14, 0.34, 0.86, 0.34, 0.035);
    p.poly(
      [
        [0.24, 0.46],
        [0.32, 0.54],
        [0.24, 0.62],
      ],
      0.045,
    );
    p.line(0.38, 0.62, 0.5, 0.62, 0.045);
  },
};

export const ICON_NAMES: string[] = Object.keys(ICONS).sort();

export interface IconOptions {
  weight?: number; // stroke-thickness multiplier (default 1)
  invert?: boolean; // swap ink and paper
}

// Render an icon as braille lines (`cols` cells wide, ~cols/2 cells tall so it
// reads square on screen). Throws on an unknown name.
export function iconToBrailleLines(
  name: string,
  cols: number,
  opts: IconOptions = {},
): string[] {
  const icon = ICONS[name];
  if (!icon) {
    throw new Error(`unknown icon "${name}"; known: ${ICON_NAMES.join(", ")}`);
  }
  const c = Math.max(4, Math.min(120, Math.round(cols)));
  const rows = Math.max(2, Math.round(c / 2));
  const subW = c * 2;
  const subH = rows * 4;
  const raster = new Raster(subW, subH);
  icon(makePen(raster, opts.weight ?? 1));

  const invert = opts.invert ?? false;
  const lines: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < c; cx++) {
      let bits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          let on = raster.get(cx * 2 + sx, cy * 4 + sy) === 1;
          if (invert) on = !on;
          if (on) bits |= BRAILLE_DOT[sy][sx];
        }
      }
      line += String.fromCodePoint(BRAILLE_BASE + bits);
    }
    lines.push(line);
  }
  return lines;
}
