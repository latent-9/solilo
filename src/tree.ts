// Tree-diagram engine: render a hierarchy (root -> branches -> leaves) as ASCII.
// Where block_diagram lays out a *linear* chain of boxes, this lays out a
// *branching* one — an org chart, a taxonomy, a dependency or lineage tree.
// Two layouts: "down" is a centered node-link tree (parents sit above and
// centered over their children, joined by box-drawing connectors); "list" is
// the familiar left-aligned file-tree ( |-- / `-- ) form. Pure: returns the
// lines; the caller stamps them onto a canvas.
//
// The "down" layout uses the classic tidy-tree idea: each subtree reserves the
// max of its own label width and its children's combined span, so nothing
// overlaps, and every parent is centered on the midpoint of its children.

export type TreeLayout = "down" | "list";
export type TreeStyle = "unicode" | "ascii";

export interface TreeDiagramOptions {
  layout?: TreeLayout; // "down" (node-link) or "list" (file-tree). Default "down".
  style?: TreeStyle; // connector charset. Default "unicode".
  boxed?: boolean; // draw a box around each node (down layout). Default false.
  gapX?: number; // columns between sibling subtrees (down). Default 3.
  title?: string; // optional centered heading.
}

interface Node {
  label: string;
  children: Node[];
  // layout scratch (down):
  cx?: number; // center column
  w?: number; // reserved subtree width
}

// --- Parse indented text into a forest ------------------------------------
// Indentation defines nesting: a line indented more than the one above is its
// child. Any consistent indent unit works (2 spaces, 4 spaces, tabs); a stack
// keyed on raw indent width handles mixed depths without a fixed unit.
export function parseIndented(src: string): Node[] {
  const roots: Node[] = [];
  const stack: { node: Node; indent: number }[] = [];
  const rawLines = src.replace(/\r/g, "").split("\n");
  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    const expanded = raw.replace(/\t/g, "  ");
    const indent = expanded.length - expanded.trimStart().length;
    const node: Node = { label: expanded.trim(), children: [] };
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (stack.length) stack[stack.length - 1].node.children.push(node);
    else roots.push(node);
    stack.push({ node, indent });
  }
  return roots;
}

// --- Connector glyphs via a 4-bit direction mask --------------------------
// bit 1=up, 2=down, 4=left, 8=right. This lets the "down" layout combine
// strokes at a junction (e.g. up+left+right -> a T) without special-casing.
const U = 1, D = 2, L = 4, R = 8;
const UNICODE_MASK: Record<number, string> = {
  [U | D]: "│", [L | R]: "─",
  [U | L]: "┘", [U | R]: "└", [D | L]: "┐", [D | R]: "┌",
  [U | D | L]: "┤", [U | D | R]: "├", [U | L | R]: "┴", [D | L | R]: "┬",
  [U | D | L | R]: "┼",
};
function maskGlyph(mask: number, style: TreeStyle): string {
  if (style === "ascii") {
    if (mask === (U | D)) return "|";
    if (mask === (L | R)) return "-";
    return "+"; // every junction/corner collapses to + in 7-bit
  }
  return UNICODE_MASK[mask] ?? " ";
}

function nodeWidth(n: Node, boxed: boolean): number {
  const label = Math.max(1, n.label.length);
  return boxed ? label + 4 : label; // box: | + space+label+space + |
}

// --- "down" layout: centered node-link tree -------------------------------
function layoutDown(
  roots: Node[],
  style: TreeStyle,
  boxed: boolean,
  gapX: number,
): string[] {
  const nodeH = boxed ? 3 : 1;
  const step = nodeH + 1; // one connector row between levels

  // Pass 1: reserve each subtree's width = max(own label, children span).
  const measure = (n: Node): number => {
    const own = nodeWidth(n, boxed);
    if (n.children.length === 0) return (n.w = own);
    let span = 0;
    n.children.forEach((c, i) => {
      if (i > 0) span += gapX;
      span += measure(c);
    });
    return (n.w = Math.max(own, span));
  };

  // Pass 2: assign centers. Children are centered within the reserved width;
  // each parent lands on the midpoint of its children's centers.
  const assign = (n: Node, left: number): void => {
    const own = nodeWidth(n, boxed);
    if (n.children.length === 0) {
      n.cx = left + Math.floor(own / 2);
      return;
    }
    let span = 0;
    n.children.forEach((c, i) => {
      if (i > 0) span += gapX;
      span += c.w!;
    });
    let x = left + Math.floor((n.w! - span) / 2);
    n.children.forEach((c, i) => {
      if (i > 0) x += gapX;
      assign(c, x);
      x += c.w!;
    });
    const first = n.children[0].cx!;
    const last = n.children[n.children.length - 1].cx!;
    n.cx = Math.round((first + last) / 2);
  };

  // Place roots side by side.
  let cursor = 0;
  for (const r of roots) {
    measure(r);
    assign(r, cursor);
    cursor += r.w! + gapX;
  }

  // Grid, sized to the deepest and widest placement. A parent label wider than
  // its children's span is centered on their midpoint, so it can start left of
  // its own center — past column 0 for the leftmost subtree. Track the true
  // left/right extent of every drawn node (`left = cx - floor(width/2)` matches
  // drawLabel for both the bare and boxed paths) and, if anything overhangs the
  // left edge, shift the whole tree right instead of letting put() clamp col>=0
  // and silently drop the label's leading characters.
  let maxDepth = 0;
  let minCol = 0;
  let maxCol = 0;
  const walk = (n: Node, depth: number): void => {
    maxDepth = Math.max(maxDepth, depth);
    const w = nodeWidth(n, boxed);
    const left = n.cx! - Math.floor(w / 2);
    minCol = Math.min(minCol, left);
    maxCol = Math.max(maxCol, left + w - 1);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((r) => walk(r, 0));

  const off = minCol < 0 ? -minCol : 0;
  if (off) {
    const shift = (n: Node): void => {
      n.cx! += off;
      n.children.forEach(shift);
    };
    roots.forEach(shift);
  }
  const width = maxCol + off + 1;
  const heightRows = maxDepth * step + nodeH;
  const grid: string[][] = Array.from({ length: heightRows }, () =>
    new Array(width).fill(" "),
  );
  const masks: number[][] = Array.from({ length: heightRows }, () =>
    new Array(width).fill(0),
  );

  const put = (row: number, col: number, ch: string): void => {
    if (row >= 0 && row < heightRows && col >= 0 && col < width) grid[row][col] = ch;
  };
  const drawLabel = (n: Node, top: number): void => {
    const label = n.label;
    if (boxed) {
      const inner = label.length + 2;
      const startTop = n.cx! - Math.floor((inner + 2) / 2);
      const bar = (style === "ascii" ? "-" : "─").repeat(inner);
      const v = style === "ascii" ? "|" : "│";
      const c = style === "ascii"
        ? { tl: "+", tr: "+", bl: "+", br: "+" }
        : { tl: "╭", tr: "╮", bl: "╰", br: "╯" };
      for (let i = 0; i < inner + 2; i++) {
        put(top, startTop + i, i === 0 ? c.tl : i === inner + 1 ? c.tr : bar[i - 1]);
        put(top + 2, startTop + i, i === 0 ? c.bl : i === inner + 1 ? c.br : bar[i - 1]);
      }
      put(top + 1, startTop, v);
      put(top + 1, startTop + inner + 1, v);
      const labelStart = startTop + 1 + Math.floor((inner - label.length) / 2);
      for (let i = 0; i < label.length; i++) put(top + 1, labelStart + i, label[i]);
    } else {
      const start = n.cx! - Math.floor(label.length / 2);
      for (let i = 0; i < label.length; i++) put(top, start + i, label[i]);
    }
  };

  const render = (n: Node, depth: number): void => {
    const top = depth * step;
    drawLabel(n, top);
    if (n.children.length) {
      const barRow = top + nodeH; // one row below this node
      const px = n.cx!;
      masks[barRow][px] |= U; // stem up into this node
      const xs = n.children.map((c) => c.cx!);
      const lo = Math.min(px, ...xs);
      const hi = Math.max(px, ...xs);
      for (let c = lo; c <= hi; c++) {
        if (c > lo) masks[barRow][c] |= L;
        if (c < hi) masks[barRow][c] |= R;
      }
      for (const cx of xs) masks[barRow][cx] |= D; // drop down to each child
      n.children.forEach((c) => render(c, depth + 1));
    }
  };
  roots.forEach((r) => render(r, 0));

  // Bake connector masks into glyphs (only where a label cell isn't already set).
  for (let r = 0; r < heightRows; r++) {
    for (let c = 0; c < width; c++) {
      if (masks[r][c] && grid[r][c] === " ") grid[r][c] = maskGlyph(masks[r][c], style);
    }
  }
  return grid.map((row) => row.join("").replace(/\s+$/, ""));
}

// --- "list" layout: left-aligned file-tree --------------------------------
function layoutList(roots: Node[], style: TreeStyle): string[] {
  const g =
    style === "ascii"
      ? { tee: "|-- ", last: "`-- ", pipe: "|   ", gap: "    " }
      : { tee: "├── ", last: "└── ", pipe: "│   ", gap: "    " };
  const out: string[] = [];
  const walk = (n: Node, prefix: string, isLast: boolean, isRoot: boolean): void => {
    if (isRoot) out.push(n.label);
    else out.push(prefix + (isLast ? g.last : g.tee) + n.label);
    const childPrefix = isRoot ? "" : prefix + (isLast ? g.gap : g.pipe);
    n.children.forEach((c, i) =>
      walk(c, childPrefix, i === n.children.length - 1, false),
    );
  };
  roots.forEach((r, i) => {
    walk(r, "", i === roots.length - 1, true);
  });
  return out.map((l) => l.replace(/\s+$/, ""));
}

function centerBlock(lines: string[], width: number): string[] {
  return lines.map((l) => {
    const pad = Math.max(0, Math.floor((width - l.length) / 2));
    return " ".repeat(pad) + l;
  });
}

/**
 * Render an indented `source` outline as a tree diagram. Indentation sets the
 * nesting. Returns right-trimmed ASCII lines; the caller stamps them.
 */
export function treeDiagram(source: string, opts: TreeDiagramOptions = {}): string[] {
  const roots = parseIndented(source ?? "");
  if (roots.length === 0) return [];
  const style = opts.style ?? "unicode";
  const layout = opts.layout ?? "down";
  const gapX = Math.max(1, Math.min(opts.gapX ?? 3, 24));

  const body =
    layout === "list"
      ? layoutList(roots, style)
      : layoutDown(roots, style, opts.boxed ?? false, gapX);

  const title = opts.title?.trim();
  if (title) {
    const bodyWidth = Math.max(0, ...body.map((l) => l.length));
    const titleLines = title.split("\n");
    const width = Math.max(bodyWidth, ...titleLines.map((l) => l.length));
    const centeredTitle = centerBlock(titleLines, width);
    const centeredBody = bodyWidth < width ? centerBlock(body, width) : body;
    return [...centeredTitle, "", ...centeredBody].map((l) => l.replace(/\s+$/, ""));
  }
  return body;
}
