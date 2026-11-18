// Lightweight ASCII canvas: a 2D character grid with basic drawing operations.
// Deliberately without CanvasKit/WASM — the MCP server only needs to produce text.

const DEFAULT_WIDTH = 48;
const DEFAULT_HEIGHT = 24;
const MAX_DIM = 400;

// Box-drawing sets for frame(): corners + horizontal/vertical edges.
export type BorderStyle = "unicode" | "round" | "double" | "bold" | "ascii";
const BORDER_STYLES: Record<BorderStyle, { tl: string; tr: string; bl: string; br: string; h: string; v: string }> = {
  unicode: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  round: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
  bold: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
};

// Glyphs that swap when mirrored, so line art flips correctly (only unambiguous
// drawing glyphs — letters are left alone so words in the art stay readable).
const H_MIRROR: Record<string, string> = {
  "/": "\\", "\\": "/", "(": ")", ")": "(", "[": "]", "]": "[",
  "{": "}", "}": "{", "<": ">", ">": "<",
  "┌": "┐", "┐": "┌", "└": "┘", "┘": "└", "├": "┤", "┤": "├",
  "╭": "╮", "╮": "╭", "╰": "╯", "╯": "╰",
  "╔": "╗", "╗": "╔", "╚": "╝", "╝": "╚", "╠": "╣", "╣": "╠",
  "┏": "┓", "┓": "┏", "┗": "┛", "┛": "┗", "┣": "┫", "┫": "┣",
};
const V_MIRROR: Record<string, string> = {
  "/": "\\", "\\": "/",
  "┌": "└", "└": "┌", "┐": "┘", "┘": "┐", "┬": "┴", "┴": "┬",
  "╭": "╰", "╰": "╭", "╮": "╯", "╯": "╮",
  "╔": "╚", "╚": "╔", "╗": "╝", "╝": "╗", "╦": "╩", "╩": "╦",
  "┏": "┗", "┗": "┏", "┓": "┛", "┛": "┓", "┳": "┻", "┻": "┳",
};

export type Anchor =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right";

export class AsciiCanvas {
  width: number;
  height: number;
  private grid: string[][];

  constructor(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT) {
    this.width = 0;
    this.height = 0;
    this.grid = [];
    this.reset(width, height);
  }

  /** Create an empty width x height canvas (filled with spaces). */
  reset(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): void {
    this.width = clampDim(width);
    this.height = clampDim(height);
    this.grid = Array.from({ length: this.height }, () =>
      Array.from({ length: this.width }, () => " "),
    );
  }

  /** Clear the canvas (keep its size). */
  clear(): void {
    this.reset(this.width, this.height);
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** Write a single character at (x, y). An empty character is treated as a space. */
  setChar(x: number, y: number, char: string): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!this.inBounds(ix, iy)) return;
    this.grid[iy][ix] = sanitizeCell(char);
  }

  getChar(x: number, y: number): string {
    const ix = Math.round(x);
    const iy = Math.round(y);
    return this.inBounds(ix, iy) ? this.grid[iy][ix] : " ";
  }

  /** Write text horizontally starting at (x, y). */
  drawText(x: number, y: number, text: string): void {
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) this.setChar(x + i, y, chars[i]);
  }

  /** A cell counts as blank for compositing: an ASCII space or a braille-blank. */
  private isBlank(ch: string): boolean {
    return ch === " " || ch === "⠀";
  }

  /**
   * Place a multi-line block of text with its top-left at (x, y). Each newline
   * starts a new row. By default spaces overwrite existing cells (the block
   * lands as-is). With `transparent`, blank cells (an ASCII space or the
   * braille-blank U+2800) are skipped, so the block composites over whatever is
   * already on the canvas — layering renders instead of erasing them.
   */
  drawBlock(x: number, y: number, text: string, transparent = false): void {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!transparent) {
        this.drawText(x, y + i, lines[i]);
        continue;
      }
      const chars = [...lines[i]];
      for (let j = 0; j < chars.length; j++) {
        if (!this.isBlank(chars[j])) this.setChar(x + j, y + i, chars[j]);
      }
    }
  }

  /** Straight line between two points (Bresenham's algorithm). */
  drawLine(x1: number, y1: number, x2: number, y2: number, char = "*"): void {
    let x0 = Math.round(x1);
    let y0 = Math.round(y1);
    const xe = Math.round(x2);
    const ye = Math.round(y2);
    const dx = Math.abs(xe - x0);
    const dy = -Math.abs(ye - y0);
    const sx = x0 < xe ? 1 : -1;
    const sy = y0 < ye ? 1 : -1;
    let err = dx + dy;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.setChar(x0, y0, char);
      if (x0 === xe && y0 === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Rectangle; `filled` fills the interior, otherwise only the border. */
  drawRect(
    x: number,
    y: number,
    width: number,
    height: number,
    char = "#",
    filled = false,
  ): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = x0 + Math.round(width) - 1;
    const y1 = y0 + Math.round(height) - 1;
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const edge = xx === x0 || xx === x1 || yy === y0 || yy === y1;
        if (filled || edge) this.setChar(xx, yy, char);
      }
    }
  }

  /**
   * Fill a rectangular region with a density gradient, mapping position to a
   * ramp (empty -> full). Great for skies, fades, fog, and atmospheric depth.
   * direction: "down" | "up" | "left" | "right" | "radial".
   */
  fillGradient(
    x: number,
    y: number,
    width: number,
    height: number,
    ramp: string,
    direction: "down" | "up" | "left" | "right" | "radial" = "down",
  ): void {
    const w = Math.max(0, Math.round(width));
    const h = Math.max(0, Math.round(height));
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const chars = [...ramp];
    if (chars.length === 0) return;
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let t: number;
        switch (direction) {
          case "up":
            t = h <= 1 ? 0 : 1 - j / (h - 1);
            break;
          case "left":
            t = w <= 1 ? 0 : 1 - i / (w - 1);
            break;
          case "right":
            t = w <= 1 ? 0 : i / (w - 1);
            break;
          case "radial": {
            const dx = w <= 1 ? 0 : (i - cx) / cx;
            const dy = h <= 1 ? 0 : (j - cy) / cy;
            t = Math.min(1, Math.hypot(dx, dy));
            break;
          }
          case "down":
          default:
            t = h <= 1 ? 0 : j / (h - 1);
            break;
        }
        const idx = Math.max(0, Math.min(chars.length - 1, Math.round(t * (chars.length - 1))));
        this.setChar(x0 + i, y0 + j, chars[idx]);
      }
    }
  }

  /**
   * Scatter a character across a region with the given density (0..1). Useful
   * for stars, stippling, grain, and organic texture. Only empty cells are
   * filled so it can be layered over existing art.
   */
  scatter(
    x: number,
    y: number,
    width: number,
    height: number,
    char: string,
    density: number,
  ): void {
    const w = Math.max(0, Math.round(width));
    const h = Math.max(0, Math.round(height));
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const ch = char.length ? char[0] : "*";
    const p = Math.max(0, Math.min(1, density));
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (this.getChar(x0 + i, y0 + j) === " " && Math.random() < p) {
          this.setChar(x0 + i, y0 + j, ch);
        }
      }
    }
  }

  /** Erase a single cell (set it to a space). */
  erase(x: number, y: number): void {
    this.setChar(x, y, " ");
  }

  /** Bounding box of non-blank content (space / braille-blank excluded), or null. */
  private contentBounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = this.width;
    let y0 = this.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!this.isBlank(this.grid[y][x])) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  /**
   * Rebuild the grid as a newW x newH window whose top-left maps to
   * (srcX, srcY) of the current grid; cells outside the old grid become spaces.
   */
  private recopy(srcX: number, srcY: number, newW: number, newH: number): void {
    const w = clampDim(newW);
    const h = clampDim(newH);
    const old = this.grid;
    const ow = this.width;
    const oh = this.height;
    this.grid = Array.from({ length: h }, (_, j) =>
      Array.from({ length: w }, (_, i) => {
        const sx = srcX + i;
        const sy = srcY + j;
        return sx >= 0 && sx < ow && sy >= 0 && sy < oh ? old[sy][sx] : " ";
      }),
    );
    this.width = w;
    this.height = h;
  }

  /** Crop to a rectangle; the result becomes the new canvas (clamped to >= 1x1). */
  crop(x: number, y: number, w: number, h: number): void {
    this.recopy(
      Math.round(x),
      Math.round(y),
      Math.max(1, Math.round(w)),
      Math.max(1, Math.round(h)),
    );
  }

  /**
   * Auto-crop blank margins around the content, keeping a `pad`-cell border.
   * Treats an ASCII space and the braille-blank (U+2800) as margin. A fully
   * blank canvas collapses to 1x1. Returns the new size.
   */
  trim(pad = 0): { width: number; height: number } {
    const b = this.contentBounds();
    if (!b) {
      this.reset(1, 1);
      return { width: this.width, height: this.height };
    }
    const p = Math.max(0, Math.round(pad));
    this.recopy(
      b.x0 - p,
      b.y0 - p,
      b.x1 - b.x0 + 1 + 2 * p,
      b.y1 - b.y0 + 1 + 2 * p,
    );
    return { width: this.width, height: this.height };
  }

  /**
   * Wrap the whole canvas in a box-drawing border, growing it by one cell (plus
   * `padding` blank cells) on every side. An optional `title` is centered on the
   * top edge. Trim first for a border that hugs the art. Returns the new size.
   */
  frame(style: BorderStyle = "unicode", title = "", padding = 0): { width: number; height: number } {
    const s = BORDER_STYLES[style] ?? BORDER_STYLES.unicode;
    const off = 1 + Math.max(0, Math.round(padding));
    this.recopy(-off, -off, this.width + 2 * off, this.height + 2 * off);

    const w = this.width;
    const h = this.height;
    for (let x = 1; x < w - 1; x++) {
      this.grid[0][x] = s.h;
      this.grid[h - 1][x] = s.h;
    }
    for (let y = 1; y < h - 1; y++) {
      this.grid[y][0] = s.v;
      this.grid[y][w - 1] = s.v;
    }
    this.grid[0][0] = s.tl;
    this.grid[0][w - 1] = s.tr;
    this.grid[h - 1][0] = s.bl;
    this.grid[h - 1][w - 1] = s.br;

    if (title) {
      const label = [...` ${title} `];
      if (label.length <= w - 2) {
        const start = Math.max(1, Math.floor((w - label.length) / 2));
        for (let i = 0; i < label.length && start + i < w - 1; i++) {
          // frame() writes the title straight to the grid, bypassing setChar, so
          // sanitize here too (a title newline/escape would otherwise split row 0).
          this.grid[0][start + i] = sanitizeCell(label[i]);
        }
      }
    }
    return { width: w, height: h };
  }

  /**
   * Mirror the canvas. "horizontal" flips left-right, "vertical" flips
   * top-bottom. Mirror-able drawing glyphs (slashes, brackets, box corners) are
   * swapped so line art stays coherent; letters are left as-is.
   */
  flip(axis: "horizontal" | "vertical" = "horizontal"): void {
    if (axis === "horizontal") {
      this.grid = this.grid.map((row) =>
        row.slice().reverse().map((ch) => H_MIRROR[ch] ?? ch),
      );
    } else {
      this.grid = this.grid
        .slice()
        .reverse()
        .map((row) => row.map((ch) => V_MIRROR[ch] ?? ch));
    }
  }

  /**
   * Resize the canvas to width x height, keeping the existing content and
   * placing it against `anchor` (default top-left). Growing pads with blanks;
   * shrinking crops whatever falls outside. Returns the new size.
   */
  resize(width: number, height: number, anchor: Anchor = "top-left"): { width: number; height: number } {
    const w = clampDim(width);
    const h = clampDim(height);
    const horiz = anchor.includes("left") ? "left" : anchor.includes("right") ? "right" : "center";
    const vert = anchor.includes("top") ? "top" : anchor.includes("bottom") ? "bottom" : "center";
    const dx = horiz === "left" ? 0 : horiz === "right" ? w - this.width : Math.round((w - this.width) / 2);
    const dy = vert === "top" ? 0 : vert === "bottom" ? h - this.height : Math.round((h - this.height) / 2);
    this.recopy(-dx, -dy, w, h);
    return { width: this.width, height: this.height };
  }

  /** Render the whole canvas as-is (rows trimmed on the right). */
  render(): string {
    return this.grid.map((row) => row.join("").replace(/\s+$/, "")).join("\n");
  }

  /** Render tightly cropped to the area containing characters (for the gallery). */
  toTrimmedText(): string {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Use the same blank test as trim()/contentBounds() so save behaves like
        // trim: a braille-blank (U+2800) is blank too. Otherwise an all-braille-
        // blank canvas reads as non-empty (isEmpty -> here) and publishes invisible
        // art, and partially-filled braille keeps a loose U+2800 border.
        if (!this.isBlank(this.grid[y][x])) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!Number.isFinite(minX)) return "";
    const lines: string[] = [];
    for (let y = minY; y <= maxY; y++) {
      let line = "";
      for (let x = minX; x <= maxX; x++) line += this.grid[y][x];
      lines.push(line.replace(/\s+$/, ""));
    }
    return lines.join("\n");
  }

  isEmpty(): boolean {
    return this.toTrimmedText().trim().length === 0;
  }
}

function clampDim(n: number): number {
  const v = Math.round(n);
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, MAX_DIM);
}

// A grid cell must be exactly one printable code point. Take the first code point
// (never half a surrogate pair) and fold C0 control chars / DEL down to a space,
// so an embedded newline/tab/ANSI-escape can't split a row on render() or leak a
// terminal escape sequence into published art.
function sanitizeCell(ch: string): string {
  const c = [...ch][0] ?? " ";
  return c < " " || c === "\x7f" ? " " : c;
}
