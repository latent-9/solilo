// Banner engine: render a short phrase as big block letters — the display-type
// counterpart to the other tools. Where shape_text pours words into a picture,
// this turns the words themselves into a picture: each letter is a 5-row glyph,
// composed side by side into a headline. Pure: returns the lines; the caller
// stamps them onto a canvas (MCP) or prints them (CLI).
//
// The font is an original, hand-authored 5-row uppercase set (A-Z, 0-9, space,
// and a little punctuation) written for this repo — no external figlet fonts,
// so the MIT project stays clean. Glyphs are drawn with "#" ink on spaces; the
// ink is swapped for a themable character at render time.

export type BannerStyle = "unicode" | "ascii";

export interface BannerOptions {
  style?: BannerStyle; // ink charset: unicode -> "█", ascii -> "#". Default unicode.
  fill?: string; // explicit ink char, overrides style.
  gap?: number; // blank columns between letters. Default 1.
}

const HEIGHT = 5;

// Each glyph is 5 rows of "#" (ink) and " " (background). Rows within a glyph
// are normalized to equal width at load, so a stray space can't misalign a
// column when glyphs are joined.
const FONT_SRC: Record<string, string[]> = {
  A: [" ### ", "#   #", "#####", "#   #", "#   #"],
  B: ["#### ", "#   #", "#### ", "#   #", "#### "],
  C: [" ####", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#### "],
  E: ["#####", "#    ", "#### ", "#    ", "#####"],
  F: ["#####", "#    ", "#### ", "#    ", "#    "],
  G: [" ####", "#    ", "#  ##", "#   #", " ####"],
  H: ["#   #", "#   #", "#####", "#   #", "#   #"],
  I: ["###", " # ", " # ", " # ", "###"],
  J: ["  ###", "    #", "    #", "#   #", " ### "],
  K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
  L: ["#    ", "#    ", "#    ", "#    ", "#####"],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #"],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #"],
  O: [" ### ", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#### ", "#    ", "#    "],
  Q: [" ### ", "#   #", "#   #", "#  # ", " ## #"],
  R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
  S: [" ####", "#    ", " ### ", "    #", "#### "],
  T: ["#####", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", " ### "],
  V: ["#   #", "#   #", "#   #", " # # ", "  #  "],
  W: ["#   #", "#   #", "# # #", "## ##", "#   #"],
  X: ["#   #", " # # ", "  #  ", " # # ", "#   #"],
  Y: ["#   #", " # # ", "  #  ", "  #  ", "  #  "],
  Z: ["#####", "   # ", "  #  ", " #   ", "#####"],
  "0": [" ### ", "#  ##", "# # #", "##  #", " ### "],
  "1": ["  #  ", " ##  ", "  #  ", "  #  ", " ### "],
  "2": [" ### ", "#   #", "  ## ", " #   ", "#####"],
  "3": ["#### ", "    #", " ### ", "    #", "#### "],
  "4": ["#   #", "#   #", "#####", "    #", "    #"],
  "5": ["#####", "#    ", "#### ", "    #", "#### "],
  "6": [" ### ", "#    ", "#### ", "#   #", " ### "],
  "7": ["#####", "    #", "   # ", "  #  ", "  #  "],
  "8": [" ### ", "#   #", " ### ", "#   #", " ### "],
  "9": [" ### ", "#   #", " ####", "    #", " ### "],
  " ": ["   ", "   ", "   ", "   ", "   "],
  "-": ["     ", "     ", "#####", "     ", "     "],
  ".": [" ", " ", " ", " ", "#"],
  ",": [" ", " ", " ", "#", "#"],
  "!": ["#", "#", "#", " ", "#"],
  "?": [" ### ", "#   #", "  ## ", "     ", "  #  "],
  "'": ["#", "#", " ", " ", " "],
  ":": [" ", "#", " ", "#", " "],
  "/": ["    #", "   # ", "  #  ", " #   ", "#    "],
  "+": ["   ", " # ", "###", " # ", "   "],
};

// Pad every glyph's rows to that glyph's own max width, and guarantee HEIGHT rows.
function normalize(src: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [ch, rows] of Object.entries(src)) {
    const width = Math.max(1, ...rows.map((r) => r.length));
    out[ch] = Array.from({ length: HEIGHT }, (_, i) =>
      (rows[i] ?? "").padEnd(width, " "),
    );
  }
  return out;
}

const FONT = normalize(FONT_SRC);
const SPACE = FONT[" "];

function glyphFor(ch: string): string[] {
  return FONT[ch] ?? SPACE; // unknown characters fall back to a blank space
}

// Render one line (no newlines) into HEIGHT rows of inked glyphs.
function renderLine(line: string, ink: string, gap: number): string[] {
  const glyphs = [...line.toUpperCase()].map(glyphFor);
  if (glyphs.length === 0) return Array.from({ length: HEIGHT }, () => "");
  const gapStr = " ".repeat(gap);
  const rows: string[] = [];
  for (let r = 0; r < HEIGHT; r++) {
    const parts = glyphs.map((g) => g[r].split("#").join(ink));
    rows.push(parts.join(gapStr));
  }
  return rows;
}

/**
 * Render `text` as big block letters. Newlines split the text into stacked
 * banner rows (a blank line between). Returns right-trimmed lines.
 */
export function bannerText(text: string, opts: BannerOptions = {}): string[] {
  const ink =
    (opts.fill && [...opts.fill][0]) || (opts.style === "ascii" ? "#" : "█");
  const gap = Math.max(0, Math.min(opts.gap ?? 1, 12));
  const lines = (text ?? "").replace(/\r/g, "").split("\n");

  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(""); // blank separator between stacked banner rows
    out.push(...renderLine(line, ink, gap));
  });
  return out.map((r) => r.replace(/\s+$/, ""));
}
