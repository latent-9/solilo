// Image -> ASCII conversion (Node, via sharp). Kept out of canvas.ts so the
// canvas stays image-library-free, and exported on its own so it can be tested
// directly.

import sharp from "sharp";

// Density ramp from empty (dark) to full (bright).
export const DENSITY_RAMP = " .:-=+*#%@";

// jp2a's default 23-step ramp (dark -> bright). jp2a (cslarsen/jp2a) is GPL-2.0;
// only this character ramp — a short lookup constant, its tonal signature — is
// reused, reimplemented from scratch. None of jp2a's code is copied, so this
// MIT project stays MIT. The finer ramp gives noticeably smoother gradation than
// the 10-step DENSITY_RAMP, which is jp2a's whole appeal.
export const JP2A_RAMP = "   ...',;:clodxkO0KXNWM";

// Unicode shade blocks — empty -> full ink. Gives a crisp 1-bit/dithered
// poster look (░▒▓█) instead of the letter-shaped density ramps.
export const BLOCKS_RAMP = " ░▒▓█"; // " ░▒▓█"

// Braille dot ramp — empty -> full. Braille cells pack a lot of ink states into
// one glyph, so as a density ramp they read as a very fine, near-continuous tone.
export const BRAILLE_RAMP =
  " ⠁⠃⠇⡇⣇⣧⣷⣿"; // " ⠁⠃⠇⡇⣇⣧⣷⣿"

// Selectable ramps for image_to_ascii and restyle_ascii.
export const RAMPS: Record<string, string> = {
  jp2a: JP2A_RAMP, // 23 steps, smooth photographic tone
  classic: DENSITY_RAMP, // 10 steps, coarse and graphic
  blocks: BLOCKS_RAMP, // 4 steps, solid shade blocks
  braille: BRAILLE_RAMP, // 8 steps, fine braille tone
};

export interface ImageToAsciiOptions {
  maxWidth?: number;
  invert?: boolean;
  ramp?: string;
  autoContrast?: boolean;
  // Gamma correction on the density mapping. jp2a maps luminance linearly; a
  // gamma pass (our extension beyond jp2a) reshapes the midtones so photos that
  // sit too dark or too washed-out spread across the ramp. 1 = linear/off;
  // <1 deepens shadows, >1 lifts them.
  gamma?: number;
  // Structure-aware rendering: detect contours (Sobel gradient) and draw them
  // as directional strokes ( | - / \ ) over the density fill, so silhouettes
  // read clearly. This is what separates artistic from flat image-to-ASCII.
  edges?: boolean;
  edgeThreshold?: number; // 0..1 gradient-magnitude cutoff (default 0.18)
  // Dithering fakes continuous tone from a few ramp levels. "bayer" = ordered
  // 4x4-matrix dither (structured cross-hatch), "floyd" = Floyd–Steinberg error
  // diffusion (organic grain), "none" (default) = plain nearest-level mapping.
  dither?: "none" | "bayer" | "floyd";
}

// Ordered-dither threshold matrix (normalized to 0..15). Standard 4x4 Bayer.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// Pick a stroke for an edge from its Sobel gradient. The stroke runs along the
// edge (perpendicular to the gradient).
function edgeStroke(gx: number, gy: number): string {
  const ax = Math.abs(gx);
  const ay = Math.abs(gy);
  if (ax * 2 <= ay) return "-"; // gradient vertical -> horizontal edge
  if (ay * 2 <= ax) return "|"; // gradient horizontal -> vertical edge
  return gx > 0 === gy > 0 ? "/" : "\\"; // diagonal
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

/**
 * Convert an image file to ASCII lines by per-cell brightness. With
 * `autoContrast` (default) the luminance range is stretched to fill the ramp,
 * so ordinary low-contrast photos still map across the whole character set
 * instead of collapsing into a few mid-tones.
 */
export async function imageToAsciiLines(
  imgPath: string,
  opts: ImageToAsciiOptions = {},
): Promise<string[]> {
  const maxWidth = clampInt(opts.maxWidth ?? 100, 4, 400);
  const invert = opts.invert ?? false;
  const ramp = opts.ramp && opts.ramp.length >= 2 ? opts.ramp : DENSITY_RAMP;
  const autoContrast = opts.autoContrast ?? true;
  const gamma = opts.gamma && opts.gamma > 0 ? opts.gamma : 1;

  const meta = await sharp(imgPath).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const cols = Math.max(4, Math.min(maxWidth, srcW));
  // Characters are about twice as tall as wide, so halve the row count.
  const rows = Math.max(2, Math.round((cols * srcH) / Math.max(1, srcW) * 0.5));

  const { data, info } = await sharp(imgPath)
    .resize(cols, rows, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  // First pass: luminance per cell, and its min/max for auto-contrast.
  const lum = new Float64Array(cols * rows);
  let min = 255;
  let max = 0;
  for (let k = 0; k < cols * rows; k++) {
    const i = k * channels;
    const alpha = channels >= 4 ? data[i + 3] / 255 : 1;
    const l =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha;
    lum[k] = l;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const span = max - min;
  const stretch = autoContrast && span > 1;

  // Normalized luminance (0..255) after auto-contrast — used for both the
  // density fill and, when enabled, the Sobel edge pass.
  const norm = new Float64Array(cols * rows);
  for (let k = 0; k < cols * rows; k++) {
    norm[k] = stretch ? ((lum[k] - min) / span) * 255 : lum[k];
  }

  const edges = opts.edges ?? false;
  const edgeThreshold = opts.edgeThreshold ?? 0.18;
  const nAt = (x: number, y: number): number =>
    norm[
      Math.max(0, Math.min(rows - 1, y)) * cols + Math.max(0, Math.min(cols - 1, x))
    ];

  const dither = opts.dither ?? "none";
  const L = ramp.length;
  const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

  // Target tone (0..1) per cell after the optional gamma reshape.
  const tone = new Float64Array(cols * rows);
  for (let k = 0; k < cols * rows; k++) {
    let t = norm[k] / 255;
    if (gamma !== 1) t = Math.pow(clamp01(t), 1 / gamma);
    tone[k] = clamp01(t);
  }

  // Quantize tone -> ramp level (0..L-1). Dithering trades a smooth gradient for
  // a patterned mix of the few ramp steps, so limited palettes read as tone.
  const level = new Int16Array(cols * rows);
  if (dither === "floyd" && L > 1) {
    const buf = Float64Array.from(tone);
    const spread = (x: number, y: number, err: number, f: number): void => {
      if (x >= 0 && x < cols && y >= 0 && y < rows) buf[y * cols + x] += err * f;
    };
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = y * cols + x;
        const t = clamp01(buf[k]);
        const q = Math.round(t * (L - 1));
        level[k] = q;
        const err = t - q / (L - 1); // Floyd–Steinberg kernel
        spread(x + 1, y, err, 7 / 16);
        spread(x - 1, y + 1, err, 3 / 16);
        spread(x, y + 1, err, 5 / 16);
        spread(x + 1, y + 1, err, 1 / 16);
      }
    }
  } else if (dither === "bayer" && L > 1) {
    const n = BAYER4.length;
    const denom = n * n;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const k = y * cols + x;
        // Threshold in -0.5..0.5, applied at ~one ramp-step amplitude.
        const threshold = (BAYER4[y % n][x % n] + 0.5) / denom - 0.5;
        const t = clamp01(tone[k] + threshold / (L - 1));
        level[k] = Math.round(t * (L - 1));
      }
    }
  } else {
    for (let k = 0; k < cols * rows; k++) level[k] = Math.round(tone[k] * (L - 1));
  }

  const lines: string[] = [];
  for (let ry = 0; ry < rows; ry++) {
    let line = "";
    for (let rx = 0; rx < cols; rx++) {
      if (edges) {
        const gx =
          nAt(rx + 1, ry - 1) + 2 * nAt(rx + 1, ry) + nAt(rx + 1, ry + 1) -
          (nAt(rx - 1, ry - 1) + 2 * nAt(rx - 1, ry) + nAt(rx - 1, ry + 1));
        const gy =
          nAt(rx - 1, ry + 1) + 2 * nAt(rx, ry + 1) + nAt(rx + 1, ry + 1) -
          (nAt(rx - 1, ry - 1) + 2 * nAt(rx, ry - 1) + nAt(rx + 1, ry - 1));
        // Sobel magnitude peaks near 4*255 for a full black/white step.
        if (Math.hypot(gx, gy) / (4 * 255) >= edgeThreshold) {
          line += edgeStroke(gx, gy);
          continue;
        }
      }
      // Box-averaged luminance mapped to the ramp (the jp2a approach), quantized
      // above with the optional gamma reshape and dither already applied.
      let idx = level[ry * cols + rx];
      if (invert) idx = L - 1 - idx;
      idx = Math.max(0, Math.min(L - 1, idx));
      line += ramp[idx];
    }
    lines.push(line);
  }
  return lines;
}

// --- image_to_braille: sub-pixel 1-bit rendering with Unicode braille ---------

// A braille cell (U+2800..U+28FF) packs a 2x4 dot grid, so one glyph carries
// eight independently-toggled dots. Rendering an image onto that grid gives 2x
// the horizontal and 4x the vertical resolution of one-glyph-per-cell density
// art — the sharpest text rendering this server can produce. Since each dot is
// on/off (1-bit), dithering is what fakes tone here, so it defaults on.
const BRAILLE_BASE = 0x2800;

// Dot bit for each (subX in 0..1, subY in 0..3) position in the 2x4 cell. The
// odd numbering (dots 1-6 then 7-8) is the Unicode braille layout.
const BRAILLE_DOT = [
  [0x01, 0x08], // top row:    dot 1, dot 4
  [0x02, 0x10], // second row: dot 2, dot 5
  [0x04, 0x20], // third row:  dot 3, dot 6
  [0x40, 0x80], // bottom row: dot 7, dot 8
];

export interface ImageToBrailleOptions {
  // Target width in braille CELLS (each cell is 2 sub-pixels wide).
  maxWidth?: number;
  // Which pixels light a dot. By default bright pixels are "ink" (matching the
  // rest of this server); invert for dark subjects on a light background.
  invert?: boolean;
  autoContrast?: boolean;
  gamma?: number;
  // Cutoff (0..1) for the plain (dither="none") threshold. Ignored when dithering.
  threshold?: number;
  // 1-bit dithering — the tone engine for braille. "floyd" (default) diffuses
  // error for a photographic grain; "bayer" is an ordered cross-hatch; "none"
  // hard-thresholds at `threshold` for crisp line art.
  dither?: "none" | "bayer" | "floyd";
  // Outline mode: run a Sobel pass at sub-pixel resolution and light a dot only
  // where the brightness gradient is steep, turning the image into a clean
  // braille line drawing. Overrides the tonal fill (dither is ignored).
  edges?: boolean;
  edgeThreshold?: number; // 0..1 gradient-magnitude cutoff (default 0.18)
}

/**
 * Convert an image to Unicode braille art at sub-pixel (2x4-per-cell)
 * resolution. Each dot is thresholded independently, with dithering (on by
 * default) faking continuous tone from the 1-bit dots — the drawille/jp2a
 * braille approach. Far sharper than the density ramps for photos and logos.
 */
export async function imageToBrailleLines(
  imgPath: string,
  opts: ImageToBrailleOptions = {},
): Promise<string[]> {
  const maxWidth = clampInt(opts.maxWidth ?? 80, 4, 400);
  const invert = opts.invert ?? false;
  const autoContrast = opts.autoContrast ?? true;
  const gamma = opts.gamma && opts.gamma > 0 ? opts.gamma : 1;
  const threshold = opts.threshold ?? 0.5;
  const dither = opts.dither ?? "floyd";
  const edges = opts.edges ?? false;
  const edgeThreshold = opts.edgeThreshold ?? 0.18;
  const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

  const meta = await sharp(imgPath).metadata();
  const srcW = meta.width ?? 1;
  const srcH = meta.height ?? 1;
  const cols = Math.max(4, Math.min(maxWidth, srcW));
  const subW = cols * 2; // sub-pixels across
  // Braille sub-pixels are ~square on screen (a cell is 2 wide x 4 tall and
  // renders about twice as tall as wide), so no half-height fudge is needed.
  const subHExact = Math.max(4, Math.round((subW * srcH) / Math.max(1, srcW)));
  const rows = Math.max(1, Math.ceil(subHExact / 4));
  const subH = rows * 4; // pad to a whole number of cells

  const { data, info } = await sharp(imgPath)
    .resize(subW, subH, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  const n = subW * subH;
  const lum = new Float64Array(n);
  let min = 255;
  let max = 0;
  for (let k = 0; k < n; k++) {
    const i = k * channels;
    const alpha = channels >= 4 ? data[i + 3] / 255 : 1;
    const l =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha;
    lum[k] = l;
    if (l < min) min = l;
    if (l > max) max = l;
  }
  const span = max - min;
  const stretch = autoContrast && span > 1;

  // Normalized brightness (0..1) per sub-pixel after auto-contrast + gamma,
  // BEFORE the invert flip — the shared source for the tonal fill and the edges.
  const base = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let t = stretch ? (lum[k] - min) / span : lum[k] / 255;
    if (gamma !== 1) t = Math.pow(clamp01(t), 1 / gamma);
    base[k] = clamp01(t);
  }

  const on = new Uint8Array(n);

  if (edges) {
    // Outline mode: light a dot where the brightness gradient is steep, so the
    // image reads as a clean braille line drawing. `invert` flips lines/space.
    const at = (x: number, y: number): number =>
      base[
        Math.max(0, Math.min(subH - 1, y)) * subW + Math.max(0, Math.min(subW - 1, x))
      ];
    for (let y = 0; y < subH; y++) {
      for (let x = 0; x < subW; x++) {
        const gx =
          at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        const gy =
          at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
          (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        // Sobel magnitude peaks at 4 for a full 0->1 brightness step.
        const hit = Math.hypot(gx, gy) / 4 >= edgeThreshold ? 1 : 0;
        on[y * subW + x] = invert ? 1 - hit : hit;
      }
    }
  } else {
    // Tonal mode: bright = ink (flipped by `invert`), quantized to 1-bit with
    // the chosen dither carrying the tone.
    const tone = new Float64Array(n);
    for (let k = 0; k < n; k++) tone[k] = invert ? 1 - base[k] : base[k];
    if (dither === "floyd") {
      const buf = Float64Array.from(tone);
      const spread = (x: number, y: number, err: number, f: number): void => {
        if (x >= 0 && x < subW && y >= 0 && y < subH) buf[y * subW + x] += err * f;
      };
      for (let y = 0; y < subH; y++) {
        for (let x = 0; x < subW; x++) {
          const k = y * subW + x;
          const t = clamp01(buf[k]);
          const q = t >= 0.5 ? 1 : 0;
          on[k] = q;
          const err = t - q;
          spread(x + 1, y, err, 7 / 16);
          spread(x - 1, y + 1, err, 3 / 16);
          spread(x, y + 1, err, 5 / 16);
          spread(x + 1, y + 1, err, 1 / 16);
        }
      }
    } else if (dither === "bayer") {
      const bn = BAYER4.length;
      const denom = bn * bn;
      for (let y = 0; y < subH; y++) {
        for (let x = 0; x < subW; x++) {
          const k = y * subW + x;
          const thr = (BAYER4[y % bn][x % bn] + 0.5) / denom; // 0..1
          on[k] = tone[k] >= thr ? 1 : 0;
        }
      }
    } else {
      for (let k = 0; k < n; k++) on[k] = tone[k] >= threshold ? 1 : 0;
    }
  }

  const lines: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      let bits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          if (on[(cy * 4 + sy) * subW + (cx * 2 + sx)]) bits |= BRAILLE_DOT[sy][sx];
        }
      }
      line += String.fromCodePoint(BRAILLE_BASE + bits);
    }
    lines.push(line);
  }
  return lines;
}

export interface TraceOptions {
  maxWidth?: number;
  threshold?: number; // 0..1 luminance cutoff; darker than this is ink
  invert?: boolean; // treat bright as ink instead of dark
  background?: string; // flatten transparency over this color (default white)
  grow?: number; // dilate the ink by this many sub-pixels (thickens thin line art)
}

/**
 * Trace a flat, two-tone illustration or logo (SVG, PNG, ...) into a crisp
 * braille icon. Unlike imageToBrailleLines (tonal, dithered, bright = ink), this
 * flattens transparency onto a solid background and hard-thresholds the DARK ink
 * of the art at sub-pixel resolution — the right pipeline for the Claude blog's
 * flat spot illustrations, brand marks, and any silhouette/stencil source, whose
 * ink sits on a transparent ground that a tonal reader would misjudge.
 */
export async function traceToBrailleLines(
  imgPath: string,
  opts: TraceOptions = {},
): Promise<string[]> {
  const maxWidth = clampInt(opts.maxWidth ?? 60, 4, 400);
  const threshold = opts.threshold ?? 0.5;
  const invert = opts.invert ?? false;
  const background = opts.background ?? "#ffffff";

  const meta = await sharp(imgPath).metadata();
  const srcW = Math.max(1, meta.width ?? 1);
  const srcH = Math.max(1, meta.height ?? 1);
  const cols = Math.max(4, Math.min(maxWidth, Math.max(4, srcW)));
  const subW = cols * 2;
  const subHExact = Math.max(4, Math.round((subW * srcH) / srcW));
  const rows = Math.max(1, Math.ceil(subHExact / 4));
  const subH = rows * 4;

  // Flatten first so transparent ground becomes bright paper and only the art's
  // dark ink survives the threshold. removeAlpha keeps the buffer at 3 channels.
  const { data, info } = await sharp(imgPath)
    .resize(subW, subH, { fit: "fill" })
    .flatten({ background })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const thr = threshold * 255;

  // Build a sub-pixel ink mask first: dark art (below threshold) is ink, unless
  // inverted. Keeping the mask separate lets us thicken it before packing.
  const ink = new Uint8Array(subW * subH);
  for (let sy = 0; sy < subH; sy++) {
    for (let sx = 0; sx < subW; sx++) {
      const i = (sy * subW + sx) * channels;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      let on = l < thr; // dark ink is the subject
      if (invert) on = !on;
      ink[sy * subW + sx] = on ? 1 : 0;
    }
  }

  // Optional dilation: thin blog line art traces as sparse dots at small sizes,
  // so grow the ink by a Chebyshev radius to read as bold, solid strokes.
  const grow = clampInt(opts.grow ?? 0, 0, 4);
  const mask = grow > 0 ? dilateMask(ink, subW, subH, grow) : ink;

  const lines: string[] = [];
  for (let cy = 0; cy < rows; cy++) {
    let line = "";
    for (let cx = 0; cx < cols; cx++) {
      let bits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 2; sx++) {
          if (mask[(cy * 4 + sy) * subW + (cx * 2 + sx)]) bits |= BRAILLE_DOT[sy][sx];
        }
      }
      line += String.fromCodePoint(BRAILLE_BASE + bits);
    }
    lines.push(line);
  }
  return lines;
}

// Morphological dilation with a square (Chebyshev) structuring element of the
// given radius. Separable: dilate along X, then along Y, so cost is O(n*r) not
// O(n*r^2). Any ink sub-pixel spreads to its neighbours within the radius.
function dilateMask(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dx = -r; dx <= r && !on; dx++) {
        const nx = x + dx;
        if (nx >= 0 && nx < w && src[y * w + nx]) on = 1;
      }
      tmp[y * w + x] = on;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = 0;
      for (let dy = -r; dy <= r && !on; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < h && tmp[ny * w + x]) on = 1;
      }
      out[y * w + x] = on;
    }
  }
  return out;
}

// --- restyle_ascii: re-map an existing ASCII drawing onto a new character set --

// Approximate ink coverage (0 = blank, 1 = solid) per glyph. Used to restyle a
// piece of ASCII art onto a different palette while preserving the picture: each
// source glyph is scored by how much ink it carries, then swapped for the target
// ramp character of the same darkness. Ordering is Paul Bourke's public-domain
// 70-level ramp (dark -> light), with the Unicode blocks pinned explicitly.
const COVERAGE_ORDER =
  "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ";

const BLOCK_COVERAGE: Record<string, number> = {
  "█": 1, "▓": 0.75, "▒": 0.5, "░": 0.25,
  "■": 0.95, "▬": 0.9, "●": 0.85, "◆": 0.8,
  "▀": 0.5, "▄": 0.5, "▌": 0.5, "▐": 0.5,
};

const GLYPH_COVERAGE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  const order = [...COVERAGE_ORDER];
  const L = order.length;
  // Darkest (index 0) -> coverage 1; lightest (last) -> 0. Keep the first
  // (darker) reading if a glyph appears more than once.
  for (let i = 0; i < L; i++) {
    if (!m.has(order[i])) m.set(order[i], (L - 1 - i) / (L - 1));
  }
  for (const [ch, v] of Object.entries(BLOCK_COVERAGE)) m.set(ch, v);
  m.set(" ", 0);
  m.set("\t", 0);
  return m;
})();

/** Ink coverage (0..1) of a single glyph; unknown printables default mid-heavy. */
export function charCoverage(ch: string): number {
  const v = GLYPH_COVERAGE.get(ch);
  return v === undefined ? 0.6 : v;
}

export interface RestyleOptions {
  // Target ramp, empty -> full ink (e.g. RAMPS.blocks). Defaults to the classic
  // density ramp. Ignored when `map` is given.
  ramp?: string;
  // Flip the tonal mapping of drawn glyphs (light <-> heavy). Background spaces
  // always stay blank, so the picture is never flooded.
  invert?: boolean;
  // Explicit source-char -> target-char substitutions. When present, this exact
  // mapping is applied (chars not listed are left unchanged) and the density
  // remap is skipped.
  map?: Record<string, string>;
}

/**
 * Recolor a block of ASCII art with a different character palette. In the
 * default mode each glyph is swapped for the target-ramp character of matching
 * darkness, so the picture is preserved but rendered in, say, shade blocks or
 * braille. With `map`, a literal per-character substitution is applied instead.
 */
export function restyleAscii(text: string, opts: RestyleOptions = {}): string[] {
  const rstrip = (s: string) => s.replace(/\s+$/, "");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  if (opts.map && Object.keys(opts.map).length > 0) {
    const map = opts.map;
    return lines.map((line) =>
      rstrip([...line].map((ch) => (ch in map ? map[ch][0] ?? ch : ch)).join("")),
    );
  }

  const ramp = opts.ramp && [...opts.ramp].length >= 2 ? [...opts.ramp] : [...DENSITY_RAMP];
  const invert = opts.invert ?? false;
  const last = ramp.length - 1;
  return lines.map((line) =>
    rstrip(
      [...line]
        .map((ch) => {
          if (ch === " " || ch === "\t") return " ";
          let c = charCoverage(ch);
          if (invert) c = 1 - c;
          return ramp[clampInt(c * last, 0, last)];
        })
        .join(""),
    ),
  );
}
