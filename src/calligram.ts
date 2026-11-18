// Calligram engine: pack a poem's words into a silhouette so the words
// themselves form the picture. The silhouette comes from a builtin shape or an
// image mask. This is the "structured text illustration" style in one call.
//
// Logic references (the method is adapted, not invented):
//  - amueller/word_cloud (MIT): a shape mask marks which cells are "inside", and
//    words are only placed there. word_cloud uses an integral image to find a
//    free rectangle for each word on a pixel canvas. Here every cell is exactly
//    one glyph, so instead of a free-rectangle search we scan each row for
//    inside-spans, densely pack whole words into them — pulling a shorter word in
//    when the next won't fit the leftover — and block-justify each run so the
//    text reaches the silhouette's edges. The same mask-fill idea on a grid.
//  - Guillaume Apollinaire, "Calligrammes" (1918): text laid out to trace an
//    image — the concrete-poetry lineage this tool descends from.
//  - Xu, Zhang & Wong, "Structure-based ASCII Art" (SIGGRAPH 2010): structure
//    over tone. Its density counterpart lives in image.ts (`edges`).

import sharp from "sharp";

// Braille sub-pixel outline. A cell can carry a 2x4 dot grid (Unicode
// U+2800..U+28FF), so the calligram can trace its silhouette's true edge at 2x
// horizontal / 4x vertical resolution — a crisp contour around the text-filled
// body. The bit layout matches image.ts's braille renderer so both subsystems
// speak the same glyphs.
const BRAILLE_BASE = 0x2800;
const BRAILLE_DOT = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

export type BuiltinShape =
  | "circle"
  | "heart"
  | "diamond"
  | "star"
  | "butterfly"
  | "triangle"
  | "tree"
  | "arrow";

export const BUILTIN_SHAPES: BuiltinShape[] = [
  "circle",
  "heart",
  "diamond",
  "star",
  "butterfly",
  "triangle",
  "tree",
  "arrow",
];

// Default height as a fraction of width, per shape. Characters are ~twice as
// tall as wide, so a round shape wants half the rows; tall subjects (a tree, an
// arrow) want more, so `shape_text` reads as an upright figure without the
// caller doing the arithmetic. Overridden by an explicit `height`.
export const SHAPE_ASPECT: Record<BuiltinShape, number> = {
  circle: 0.5,
  heart: 0.5,
  diamond: 0.5,
  star: 0.5,
  butterfly: 0.5,
  triangle: 0.5,
  tree: 0.85,
  arrow: 0.9,
};

export interface ShapeTextOptions {
  width?: number;
  height?: number;
  repeat?: boolean; // loop the text to fill the whole shape (default true)
  // How each row's words fill its inside-span. "full" (default) packs whole words
  // edge to edge — looking ahead for a short word to fill a narrow tail — so the
  // silhouette reads solid without ever chopping a word; "center"/"left" keep a
  // simpler single-spaced alignment.
  justify?: "left" | "center" | "full";
  // Image-mask options (ignored for builtin shapes):
  threshold?: number; // 0..1 luminance cutoff; darker cells are "inside"
  invert?: boolean; // treat bright cells as inside instead
  // Trace the silhouette's edge with braille dots at sub-pixel resolution while
  // the interior fills with text. Off by default (plain text-only calligram).
  outline?: boolean;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// Ray-casting point-in-polygon, used for shapes easier to express as vertices.
function pointInPolygon(u: number, v: number, pts: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    const hit =
      yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// Ten-vertex regular star (5 outer tips, 5 inner), one tip pointing up.
function starPolygon(): number[][] {
  const pts: number[][] = [];
  const n = 5;
  const outer = 1;
  const inner = 0.42;
  for (let i = 0; i < 2 * n; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = Math.PI / 2 - (i * Math.PI) / n; // start at top, go clockwise
    pts.push([r * Math.cos(ang), r * Math.sin(ang)]);
  }
  return pts;
}

// Is (u, v) inside the disk of radius r centered at (cx, cy)?
function disk(u: number, v: number, cx: number, cy: number, r: number): boolean {
  const du = u - cx;
  const dv = v - cy;
  return du * du + dv * dv <= r * r;
}

// Is normalized point (u, v) — both in [-1, 1], v pointing up — inside `shape`?
function insideBuiltin(
  shape: BuiltinShape,
  u: number,
  v: number,
  star: number[][] | null,
): boolean {
  switch (shape) {
    case "circle":
      return u * u + v * v <= 1;
    case "diamond":
      return Math.abs(u) + Math.abs(v) <= 1;
    case "triangle": {
      const t = (v + 1) / 2; // 0 at base, 1 at apex
      return v >= -1 && v <= 1 && Math.abs(u) <= 1 - t;
    }
    case "heart": {
      const x = u * 1.25;
      const y = v * 1.15 + 0.22;
      const a = x * x + y * y - 1;
      return a * a * a - x * x * y * y * y <= 0;
    }
    case "butterfly": {
      const au = Math.abs(u); // mirror for perfect symmetry
      const body = au <= 0.07 && v >= -0.75 && v <= 0.7;
      const upper =
        ((au - 0.42) / 0.34) ** 2 + ((v - 0.3) / 0.42) ** 2 <= 1;
      const lower =
        ((au - 0.34) / 0.3) ** 2 + ((v + 0.34) / 0.34) ** 2 <= 1;
      return body || upper || lower;
    }
    case "star":
      return star ? pointInPolygon(u, v, star) : u * u + v * v <= 1;
    case "tree": {
      // A lumpy rounded canopy (union of overlapping blobs) sitting on a word
      // trunk that flares into roots at the ground — a full tree in one mask, so
      // the trunk fills with the poem's short words instead of being drawn apart.
      const canopy =
        disk(u, v, 0.0, 0.5, 0.5) ||
        disk(u, v, -0.5, 0.28, 0.44) ||
        disk(u, v, 0.5, 0.28, 0.44) ||
        disk(u, v, 0.0, 0.3, 0.58) ||
        disk(u, v, -0.32, 0.05, 0.42) ||
        disk(u, v, 0.32, 0.05, 0.42);
      // Trunk rises slightly into the canopy; a root flare widens near the base.
      const flare = v < -0.6 ? (-0.6 - v) * 0.9 : 0;
      const trunk = v <= 0.15 && v >= -1 && Math.abs(u) <= 0.12 + flare;
      return canopy || trunk;
    }
    case "arrow": {
      // An upward arrow: a triangular head over a straight shaft — a directed
      // structure for flow/architecture pieces.
      const headBase = 0.1;
      if (v >= headBase) {
        const t = (v - headBase) / (1 - headBase); // 0 at head base, 1 at tip
        return Math.abs(u) <= 1 - t;
      }
      return Math.abs(u) <= 0.32; // shaft
    }
    default:
      return false;
  }
}

function maskFromShape(shape: BuiltinShape, W: number, H: number): boolean[][] {
  const star = shape === "star" ? starPolygon() : null;
  const mask: boolean[][] = [];
  for (let y = 0; y < H; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < W; x++) {
      const u = W <= 1 ? 0 : (x / (W - 1)) * 2 - 1;
      const v = H <= 1 ? 0 : 1 - (y / (H - 1)) * 2;
      row.push(insideBuiltin(shape, u, v, star));
    }
    mask.push(row);
  }
  return mask;
}

async function maskFromImage(
  imgPath: string,
  W: number,
  H: number,
  threshold: number,
  invert: boolean,
): Promise<boolean[][]> {
  const { data, info } = await sharp(imgPath)
    .resize(W, H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;

  // Luminance per cell, auto-contrast stretched so `threshold` is meaningful.
  const lum = new Float64Array(W * H);
  let min = 255;
  let max = 0;
  for (let k = 0; k < W * H; k++) {
    const i = k * ch;
    const alpha = ch >= 4 ? data[i + 3] / 255 : 1;
    const l =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha;
    lum[k] = l;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const span = max - min || 1;

  const mask: boolean[][] = [];
  for (let y = 0; y < H; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < W; x++) {
      const n = (lum[y * W + x] - min) / span; // 0 dark .. 1 bright
      let inside = n < threshold; // dark pixels are the subject by default
      if (invert) inside = !inside;
      row.push(inside);
    }
    mask.push(row);
  }
  return mask;
}

// Sample a builtin shape at braille sub-pixel resolution: 2 columns x 4 rows of
// dots per cell, so `subInside[sy][sx]` is a (W*2) x (H*4) inside/outside grid.
function subInsideFromShape(
  shape: BuiltinShape,
  W: number,
  H: number,
): boolean[][] {
  const subW = W * 2;
  const subH = H * 4;
  const star = shape === "star" ? starPolygon() : null;
  const sub: boolean[][] = [];
  for (let sy = 0; sy < subH; sy++) {
    const row: boolean[] = [];
    for (let sx = 0; sx < subW; sx++) {
      const u = subW <= 1 ? 0 : (sx / (subW - 1)) * 2 - 1;
      const v = subH <= 1 ? 0 : 1 - (sy / (subH - 1)) * 2;
      row.push(insideBuiltin(shape, u, v, star));
    }
    sub.push(row);
  }
  return sub;
}

// Collapse a sub-pixel grid to one boolean per cell: a cell is "inside" for text
// when at least half of its 8 sub-pixels are inside. Used only in outline mode;
// the plain path keeps its original cell-center sampling untouched.
function cellMaskFromSub(sub: boolean[][], W: number, H: number): boolean[][] {
  const mask: boolean[][] = [];
  for (let y = 0; y < H; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < W; x++) {
      let count = 0;
      for (let dy = 0; dy < 4; dy++)
        for (let dx = 0; dx < 2; dx++)
          if (sub[y * 4 + dy][x * 2 + dx]) count++;
      row.push(count >= 4);
    }
    mask.push(row);
  }
  return mask;
}

// One braille glyph per cell tracing the silhouette's inner rim: a dot lights
// when its sub-pixel is inside the shape but touches an outside (or off-canvas)
// neighbor. Cells with no rim dot get null (fully interior or fully exterior),
// leaving the interior free for text.
function outlineFromSub(
  sub: boolean[][],
  W: number,
  H: number,
): (string | null)[][] {
  const subW = W * 2;
  const subH = H * 4;
  const at = (sx: number, sy: number): boolean =>
    sx >= 0 && sy >= 0 && sx < subW && sy < subH && sub[sy][sx];
  const grid: (string | null)[][] = [];
  for (let y = 0; y < H; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < W; x++) {
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx;
          const sy = y * 4 + dy;
          if (!at(sx, sy)) continue; // only inside dots can be on the rim
          const boundary =
            !at(sx - 1, sy) ||
            !at(sx + 1, sy) ||
            !at(sx, sy - 1) ||
            !at(sx, sy + 1);
          if (boundary) bits |= BRAILLE_DOT[dy][dx];
        }
      }
      row.push(bits === 0 ? null : String.fromCodePoint(BRAILLE_BASE + bits));
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Lay out `text` so its words fill a silhouette. Pass either a builtin `shape`
 * or an image `path`; the words trace that outline. Returns the ASCII lines
 * (top-left aligned, right-trimmed) — the caller stamps them onto a canvas.
 */
export async function shapeText(
  text: string,
  source: { shape?: BuiltinShape; path?: string },
  opts: ShapeTextOptions = {},
): Promise<string[]> {
  const width = clampInt(opts.width ?? 60, 4, 400);
  // Default the row count from the shape's natural aspect (a tree is tall, a
  // circle is round); an image mask falls back to half-width. An explicit
  // `height` always wins.
  const aspect = source.shape ? SHAPE_ASPECT[source.shape] ?? 0.5 : 0.5;
  const height = clampInt(opts.height ?? Math.round(width * aspect), 2, 400);
  const repeat = opts.repeat ?? true;
  const justify = opts.justify ?? "full";
  const outline = opts.outline ?? false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // `textMask` marks the cells that words fill. In outline mode it also carves
  // out the rim cells (they carry braille edge glyphs, not text) and derives
  // from a sub-pixel sampling so the silhouette lands truer.
  let textMask: boolean[][];
  let outlineGrid: (string | null)[][] | null = null;
  if (outline) {
    const sub = source.path
      ? await maskFromImage(
          source.path,
          width * 2,
          height * 4,
          opts.threshold ?? 0.5,
          opts.invert ?? false,
        )
      : subInsideFromShape(source.shape ?? "circle", width, height);
    const cellMask = cellMaskFromSub(sub, width, height);
    outlineGrid = outlineFromSub(sub, width, height);
    textMask = cellMask.map((r, y) =>
      r.map((inside, x) => inside && outlineGrid![y][x] === null),
    );
  } else {
    textMask = source.path
      ? await maskFromImage(
          source.path,
          width,
          height,
          opts.threshold ?? 0.5,
          opts.invert ?? false,
        )
      : maskFromShape(source.shape ?? "circle", width, height);
  }

  // A calligram reads best when the poem stays READABLE — whole words, never a
  // chopped fragment — while the silhouette still lands solid. The "full" layout
  // (the default) flows the words continuously through the mask; when a run's
  // tail is too short for the next word it looks ahead for a shorter word that
  // fits, so a narrow sliver carries a real word instead of a gap. Both edges of
  // every run land on a glyph. "left"/"center" keep a simpler single-spaced,
  // ragged style for callers that want plainly aligned lines.

  // A cyclic word stream, buffered so the "full" fill can reach past the next
  // word to find a short one that fits a narrow tail. `refill` tops the buffer
  // up; with repeat off the stream stops at the poem's last word.
  const LOOKAHEAD = 48; // how far past the next word we hunt for a sliver-filler
  let feed = 0;
  const buffer: string[] = [];
  const refill = (want: number): void => {
    while (buffer.length < want) {
      if (!repeat && feed >= words.length) break;
      buffer.push(words[feed % words.length]);
      feed++;
    }
  };
  // repeat:false — the poem is fully placed once the stream and buffer run dry.
  const drained = (): boolean =>
    !repeat && feed >= words.length && buffer.length === 0;

  let spent = false;
  // Solid, whole-word fill of a run [sx, sx+len): pack words left to right with
  // single-space separators; when the next word overruns the tail, pull the
  // first later word that fits so the sliver reads as a word, not a hole. A span
  // thinner than every word (rare) hard-crops one word so the cell still fills.
  const fillSolidWords = (row: string[], sx: number, len: number): void => {
    if (spent) return;
    refill(LOOKAHEAD);
    if (buffer.length === 0) {
      spent = true;
      return;
    }
    const chosen: string[] = [];
    let used = 0;
    // 1) In-order fill: take the next word while it fits, so the poem reads in
    //    sequence through the body of the run.
    for (;;) {
      refill(LOOKAHEAD);
      if (buffer.length === 0) break;
      const cost = (chosen.length === 0 ? 0 : 1) + buffer[0].length;
      if (cost > len - used) break;
      used += cost;
      chosen.push(buffer.shift() as string);
    }
    // 2) Fill the leftover tail by look-ahead: borrow the first later word short
    //    enough to fit, so a narrow sliver reads as a word rather than a gap. The
    //    in-order head is untouched — the skipped long word waits for the next
    //    run. A span thinner than every word (rare) hard-crops one word.
    while (used < len) {
      const gap = len - used;
      refill(LOOKAHEAD);
      let pick = -1;
      for (let j = 0; j < buffer.length; j++) {
        const cost = (chosen.length === 0 ? 0 : 1) + buffer[j].length;
        if (cost <= gap) {
          pick = j;
          break;
        }
      }
      if (pick === -1) {
        if (chosen.length === 0 && buffer.length > 0) {
          const frag = (buffer.shift() as string).slice(0, len);
          for (let k = 0; k < frag.length; k++) row[sx + k] = frag[k];
        }
        break;
      }
      const w = buffer.splice(pick, 1)[0];
      used += (chosen.length === 0 ? 0 : 1) + w.length;
      chosen.push(w);
    }
    if (chosen.length > 0) {
      const s = chosen.join(" ");
      for (let i = 0; i < s.length && i < len; i++) row[sx + i] = s[i];
    }
    if (drained()) spent = true;
  };

  // Whole-word fill for the left/center modes: pack words with single spaces then
  // align in the run. Ragged edges by design — these modes favor readable words.
  let wi = 0;
  let exhausted = false;
  const fillWords = (row: string[], sx: number, len: number): void => {
    if (exhausted) return;
    const chosen: string[] = [];
    let used = 0;
    while (true) {
      const w = words[wi % words.length];
      const need = chosen.length ? used + 1 + w.length : w.length;
      if (need <= len) {
        used = need;
        chosen.push(w);
        wi++;
        if (!repeat && wi >= words.length) {
          exhausted = true;
          break;
        }
      } else if (chosen.length === 0) {
        // A word wider than the whole run: hard-crop it so the cell still fills.
        chosen.push(w.slice(0, len));
        wi++;
        if (!repeat && wi >= words.length) exhausted = true;
        break;
      } else {
        break;
      }
    }
    if (chosen.length === 0) return;
    const s = chosen.join(" ");
    const start =
      justify === "left" ? sx : sx + Math.floor((len - s.length) / 2);
    for (let i = 0; i < s.length && start + i < sx + len; i++)
      row[start + i] = s[i];
  };

  const fillSpan = justify === "full" ? fillSolidWords : fillWords;

  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    const row: string[] = new Array(width).fill(" ");
    let x = 0;
    while (x < width) {
      if (!textMask[y][x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < width && textMask[y][end]) end++;
      fillSpan(row, x, end - x);
      x = end;
    }
    // Overlay the braille rim last so it survives on top of any text. Braille
    // dots are not ASCII whitespace, so a trailing rim glyph is kept.
    if (outlineGrid) {
      for (let gx = 0; gx < width; gx++) {
        const g = outlineGrid[y][gx];
        if (g) row[gx] = g;
      }
    }
    lines.push(row.join("").replace(/\s+$/, ""));
  }
  return lines;
}
