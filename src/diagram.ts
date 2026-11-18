// Block-diagram engine: render a sequence of labeled boxes joined by connectors
// into ASCII lines. This is the counterpart to the calligram engine — where
// shape_text pours words into one silhouette, this lays out a *structure*: the
// stacked labeled blocks of an architecture figure (a transformer encoder, a
// pipeline, a flow chart). Pure: returns the lines; the caller stamps them.

export type DiagramStyle = "ascii" | "unicode" | "double";
export type DiagramDirection = "down" | "up" | "right" | "left";
export type ConnectorStyle = "arrow" | "line" | "none";

interface StyleChars {
  tl: string;
  tr: string;
  bl: string;
  br: string;
  h: string; // horizontal border
  v: string; // vertical border
  down: string;
  up: string;
  left: string;
  right: string;
}

// Box + connector glyphs per style. `ascii` stays in the 7-bit set for maximum
// portability; `unicode` uses rounded box-drawing for a clean modern look;
// `double` uses the heavier double-line set for emphasis. Arrowheads are shared
// solid triangles (single BMP code units, so the canvas stores them fine).
const STYLES: Record<DiagramStyle, StyleChars> = {
  ascii: {
    tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|",
    down: "v", up: "^", left: "<", right: ">",
  },
  unicode: {
    tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│",
    down: "▼", up: "▲", left: "◀", right: "▶",
  },
  double: {
    tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║",
    down: "▼", up: "▲", left: "◀", right: "▶",
  },
};

export interface BlockDiagramOptions {
  direction?: DiagramDirection; // flow direction (default "down")
  style?: DiagramStyle; // box/border charset (default "unicode")
  connector?: ConnectorStyle; // arrow between boxes (default "arrow")
  gap?: number; // connector length in cells (default 1)
  padX?: number; // horizontal padding inside each box (default 2)
  align?: "left" | "center" | "right"; // label alignment (default "center")
  title?: string; // optional centered heading above the diagram
}

// Split a block's label into display lines, dropping empty edges.
function labelLines(label: string): string[] {
  const lines = label.replace(/\r/g, "").split("\n");
  return lines.length ? lines : [""];
}

// Build one box as an array of equal-width rows.
function makeBox(
  lines: string[],
  contentWidth: number,
  s: StyleChars,
  align: "left" | "center" | "right",
  padX: number,
): string[] {
  const border = s.h.repeat(contentWidth);
  const rows = [s.tl + border + s.tr];
  for (const line of lines) {
    const slack = contentWidth - line.length;
    let left: number;
    if (align === "left") left = padX;
    else if (align === "right") left = slack - padX;
    else left = Math.floor(slack / 2);
    left = Math.max(0, Math.min(left, slack));
    rows.push(s.v + " ".repeat(left) + line + " ".repeat(slack - left) + s.v);
  }
  rows.push(s.bl + border + s.br);
  return rows;
}

// Left-pad each line so the block is centered within `width`.
function centerBlock(lines: string[], width: number): string[] {
  return lines.map((l) => {
    const pad = Math.max(0, Math.floor((width - l.length) / 2));
    return " ".repeat(pad) + l;
  });
}

function stripRight(lines: string[]): string[] {
  return lines.map((l) => l.replace(/\s+$/, ""));
}

// Vertical stack (down / up): equal-width boxes joined by centered connectors.
function layoutVertical(
  blocks: string[],
  s: StyleChars,
  opts: Required<Pick<BlockDiagramOptions, "connector" | "gap" | "padX" | "align">>,
  pointUp: boolean,
): string[] {
  const order = pointUp ? [...blocks].reverse() : blocks;
  const perBox = order.map(labelLines);
  const maxLabel = Math.max(
    1,
    ...perBox.flat().map((l) => l.length),
  );
  const contentWidth = maxLabel + 2 * opts.padX;
  const boxWidth = contentWidth + 2;
  const center = Math.floor(boxWidth / 2);
  const head = pointUp ? s.up : s.down;

  // One connector: `gap` rows with the stem centered; the arrowhead sits next
  // to the box it points into (bottom for down-flow, top for up-flow).
  const connector = (): string[] => {
    if (opts.connector === "none") return [];
    const rows: string[] = [];
    for (let i = 0; i < opts.gap; i++) {
      const isHead =
        opts.connector === "arrow" && (pointUp ? i === 0 : i === opts.gap - 1);
      const ch = isHead ? head : s.v;
      rows.push(" ".repeat(center) + ch);
    }
    return rows;
  };

  const out: string[] = [];
  perBox.forEach((lines, i) => {
    if (i > 0) out.push(...connector());
    out.push(...makeBox(lines, contentWidth, s, opts.align, opts.padX));
  });
  return out;
}

// Horizontal flow (right / left): boxes side by side, vertically centered, with
// a connector at the middle row.
function layoutHorizontal(
  blocks: string[],
  s: StyleChars,
  opts: Required<Pick<BlockDiagramOptions, "connector" | "gap" | "padX" | "align">>,
  pointLeft: boolean,
): string[] {
  const order = pointLeft ? [...blocks].reverse() : blocks;
  const boxes = order.map((label) => {
    const lines = labelLines(label);
    const contentWidth = Math.max(1, ...lines.map((l) => l.length)) + 2 * opts.padX;
    return makeBox(lines, contentWidth, s, opts.align, opts.padX);
  });
  const maxH = Math.max(...boxes.map((b) => b.length));
  const midRow = Math.floor(maxH / 2);
  const widths = boxes.map((b) => b[0].length);

  // Pad each box to `maxH` rows, vertically centered.
  const padded = boxes.map((b, i) => {
    const top = Math.floor((maxH - b.length) / 2);
    const rows: string[] = [];
    for (let r = 0; r < maxH; r++) {
      const br = r - top;
      rows.push(br >= 0 && br < b.length ? b[br] : " ".repeat(widths[i]));
    }
    return rows;
  });

  const head = pointLeft ? s.left : s.right;
  const connectorRow = (): string => {
    if (opts.connector === "none") return " ".repeat(opts.gap);
    if (opts.connector === "line") return s.h.repeat(opts.gap);
    return pointLeft
      ? head + s.h.repeat(Math.max(0, opts.gap - 1))
      : s.h.repeat(Math.max(0, opts.gap - 1)) + head;
  };

  const out: string[] = [];
  for (let r = 0; r < maxH; r++) {
    let line = "";
    padded.forEach((rows, i) => {
      if (i > 0) line += r === midRow ? connectorRow() : " ".repeat(opts.gap);
      line += rows[r];
    });
    out.push(line);
  }
  return out;
}

/**
 * Render `blocks` as a connected block diagram. Each block is a label (use "\n"
 * for a multi-line label). Returns right-trimmed ASCII lines; the caller stamps
 * them onto a canvas.
 */
export function blockDiagram(
  blocks: string[],
  opts: BlockDiagramOptions = {},
): string[] {
  const clean = blocks.map((b) => (b ?? "").toString()).filter((b) => b.length > 0);
  if (clean.length === 0) return [];

  const s = STYLES[opts.style ?? "unicode"];
  const req = {
    connector: opts.connector ?? "arrow",
    gap: Math.max(1, Math.min(opts.gap ?? 1, 12)),
    padX: Math.max(0, Math.min(opts.padX ?? 2, 12)),
    align: opts.align ?? "center",
  } as const;
  const direction = opts.direction ?? "down";

  let body: string[];
  if (direction === "right" || direction === "left") {
    body = layoutHorizontal(clean, s, req, direction === "left");
  } else {
    body = layoutVertical(clean, s, req, direction === "up");
  }

  // Optional centered title above the figure.
  const title = opts.title?.trim();
  if (title) {
    const bodyWidth = Math.max(...body.map((l) => l.length));
    const titleLines = title.split("\n");
    const width = Math.max(bodyWidth, ...titleLines.map((l) => l.length));
    const centeredTitle = centerBlock(titleLines, width);
    const centeredBody = bodyWidth < width ? centerBlock(body, width) : body;
    return stripRight([...centeredTitle, "", ...centeredBody]);
  }

  return stripRight(body);
}
