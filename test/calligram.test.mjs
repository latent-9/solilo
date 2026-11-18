// Tests for the shape_text calligram engine (words packed into a silhouette).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { shapeText, BUILTIN_SHAPES, SHAPE_ASPECT } from "../dist/calligram.js";

// Build a grayscale PNG from a per-pixel callback and return its temp path.
async function tmpImage(name, w, h, fn) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y, w, h) & 0xff;
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = v;
    }
  }
  const p = path.join(os.tmpdir(), `glyph-cal-${name}-${process.pid}.png`);
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(p);
  return p;
}

const POEM =
  "love is a small mark that keeps meaning something after the hand is gone";
const wordCount = (lines) => lines.join(" ").split(/\s+/).filter(Boolean).length;

test("empty text yields no lines", async () => {
  assert.deepEqual(await shapeText("   ", { shape: "circle" }), []);
});

test("every builtin shape renders some text", async () => {
  for (const shape of BUILTIN_SHAPES) {
    const lines = await shapeText(POEM, { shape }, { width: 40 });
    assert.ok(lines.join("").trim().length > 0, `${shape} should render text`);
  }
});

test("a circle bulges: the middle row is wider than the edges", async () => {
  const lines = await shapeText(POEM, { shape: "circle" }, { width: 48 });
  const widths = lines.map((l) => l.trimEnd().length);
  const mid = widths[Math.floor(widths.length / 2)];
  assert.ok(mid > widths[0], "middle wider than the top");
  assert.ok(mid > widths[widths.length - 1], "middle wider than the bottom");
});

test("only characters from the text appear (plus spaces)", async () => {
  const text = "abcdef ghijk lmno";
  const allowed = new Set([...text.replace(/\s/g, ""), " "]);
  const lines = await shapeText(text, { shape: "diamond" }, { width: 30 });
  for (const ch of lines.join(""))
    assert.ok(allowed.has(ch), `stray char: ${JSON.stringify(ch)}`);
});

test("words are never truncated in narrow spans", async () => {
  // Butterfly and star have thin features (a 2-cell body channel, star points).
  // tree and arrow add a narrow trunk/shaft. Every word here is shorter than each
  // shape's widest run, so the packer must place whole words and leave slivers
  // blank (or fill them via look-ahead) — never a chopped fragment like "ev".
  const words = new Set(POEM.split(" "));
  for (const shape of ["butterfly", "star", "heart", "tree", "arrow"]) {
    const lines = await shapeText(POEM, { shape }, { width: 44, repeat: true });
    for (const token of lines.join(" ").split(/\s+/).filter(Boolean))
      assert.ok(words.has(token), `${shape}: truncated fragment ${JSON.stringify(token)}`);
  }
});

test("tree and arrow are available as tall builtin shapes", () => {
  for (const shape of ["tree", "arrow"]) {
    assert.ok(BUILTIN_SHAPES.includes(shape), `${shape} should be a builtin`);
    assert.ok(SHAPE_ASPECT[shape] > 0.5, `${shape} should default taller than round`);
  }
});

test("a tree defaults to an upright silhouette (taller than a circle)", async () => {
  const width = 50;
  const tree = await shapeText(POEM, { shape: "tree" }, { width });
  const circle = await shapeText(POEM, { shape: "circle" }, { width });
  assert.ok(
    tree.length > circle.length,
    `tree (${tree.length} rows) should be taller than circle (${circle.length})`,
  );
});

test("a tree's trunk fills with words rather than leaving a blank column", async () => {
  // With repeat on, the narrow trunk should pull the poem's short words in via
  // look-ahead. Assert the lower third (trunk + roots) is not a blank void.
  const lines = await shapeText(POEM, { shape: "tree" }, { width: 54, repeat: true });
  const lower = lines.slice(Math.floor(lines.length * 0.66));
  const filled = lower.filter((l) => l.trim().length > 0).length;
  assert.ok(
    filled >= Math.ceil(lower.length * 0.6),
    `trunk region should be mostly filled (${filled}/${lower.length} rows)`,
  );
});

const isBraille = (c) => {
  const cp = c.codePointAt(0);
  return cp >= 0x2800 && cp <= 0x28ff;
};

test("outline off leaves the calligram pure text (no braille glyphs)", async () => {
  const lines = await shapeText(POEM, { shape: "circle" }, { width: 40 });
  assert.ok(
    ![...lines.join("")].some(isBraille),
    "the default path must not emit any braille",
  );
});

test("outline traces the rim with braille while text fills the interior", async () => {
  const lines = await shapeText(POEM, { shape: "circle" }, {
    width: 40,
    outline: true,
  });
  const joined = lines.join("");
  const braille = [...joined].filter(isBraille);
  assert.ok(braille.length > 0, "the rim should be drawn with braille dots");
  // Every braille glyph is a real, non-blank cell in the block.
  assert.ok(
    braille.every((c) => c.codePointAt(0) > 0x2800),
    "no blank braille cells are emitted as outline",
  );
  // The interior still holds the poem's letters.
  assert.ok(/[a-z]/.test(joined), "words still fill the body");
});

test("outline rim sits on the silhouette's edge, not its center", async () => {
  // On a filled circle, the middle row's first and last non-blank cells are the
  // rim (braille), and the interior between them is body text. Block
  // justification can land an inter-word space on the exact center cell, so
  // assert text fills the interior on both sides of center rather than pinning
  // one cell — the point is the rim stays on the edge, not in the middle.
  const lines = await shapeText(POEM, { shape: "circle" }, {
    width: 48,
    outline: true,
  });
  const mid = lines[Math.floor(lines.length / 2)];
  const cells = [...mid];
  const first = cells.findIndex((c) => c !== " ");
  let last = cells.length - 1;
  while (last > 0 && cells[last] === " ") last--;
  assert.ok(isBraille(cells[first]), "left edge of the row is a rim dot");
  assert.ok(isBraille(cells[last]), "right edge of the row is a rim dot");
  const center = Math.floor((first + last) / 2);
  assert.ok(!isBraille(cells[center]), "the row's center is body text, not rim");
  const leftHalf = cells.slice(first + 1, center);
  const rightHalf = cells.slice(center + 1, last);
  assert.ok(
    leftHalf.some((c) => /[a-z]/.test(c)) && rightHalf.some((c) => /[a-z]/.test(c)),
    "text fills the interior on both sides of center",
  );
});

test("outline works from an image mask too (dark disk on white)", async () => {
  // A dark disk on a white field: dark pixels are the subject, so the words fill
  // the disk and braille traces its curved rim at sub-pixel resolution.
  const p = await tmpImage("disk", 60, 60, (x, y, w, h) => {
    const dx = x - (w - 1) / 2;
    const dy = y - (h - 1) / 2;
    return Math.hypot(dx, dy) <= w * 0.4 ? 0 : 255;
  });
  const lines = await shapeText(POEM, { path: p }, {
    width: 44,
    height: 22,
    outline: true,
  });
  const joined = lines.join("");
  assert.ok([...joined].some(isBraille), "the disk's rim is drawn in braille");
  assert.ok(/[a-z]/.test(joined), "the poem fills the disk interior");
  await fs.unlink(p);
});

test("repeat=false writes the poem once; repeat=true fills more", async () => {
  const once = await shapeText(POEM, { shape: "circle" }, {
    width: 48,
    repeat: false,
  });
  const filled = await shapeText(POEM, { shape: "circle" }, {
    width: 48,
    repeat: true,
  });
  const poemWords = POEM.split(" ").length;
  assert.ok(
    wordCount(once) <= poemWords + 1,
    "single pass should not exceed the poem length",
  );
  assert.ok(wordCount(filled) > wordCount(once), "repeat should place more words");
});
