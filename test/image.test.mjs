// Tests for image_to_ascii (the jp2a-style tonal engine plus Sobel edges).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  imageToAsciiLines,
  imageToBrailleLines,
  JP2A_RAMP,
  RAMPS,
  DENSITY_RAMP,
} from "../dist/image.js";

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
  const p = path.join(os.tmpdir(), `glyph-${name}-${process.pid}.png`);
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(p);
  return p;
}

const midRow = (lines) => lines[Math.floor(lines.length / 2)];

test("JP2A_RAMP is the 23-step ramp exposed as a preset", () => {
  assert.equal(JP2A_RAMP.length, 23);
  assert.equal(RAMPS.jp2a, JP2A_RAMP);
  assert.equal(RAMPS.classic, DENSITY_RAMP);
});

test("a left-to-right gradient spans the ramp ends", async () => {
  const w = 64;
  const p = await tmpImage("grad", w, 8, (x) => Math.round((x / (w - 1)) * 255));
  const ramp = DENSITY_RAMP;
  const lines = await imageToAsciiLines(p, { maxWidth: 40, ramp });
  assert.ok(lines.length >= 2);
  const row = midRow(lines);
  assert.equal(row[0], ramp[0]); // darkest -> ramp start
  assert.equal(row[row.length - 1], ramp[ramp.length - 1]); // brightest -> ramp end
  await fs.unlink(p);
});

test("invert flips the mapping", async () => {
  const w = 64;
  const p = await tmpImage("grad2", w, 8, (x) => Math.round((x / (w - 1)) * 255));
  const ramp = DENSITY_RAMP;
  const lines = await imageToAsciiLines(p, { maxWidth: 40, ramp, invert: true });
  assert.equal(midRow(lines)[0], ramp[ramp.length - 1]); // dark -> ramp end
  await fs.unlink(p);
});

test("gamma reshapes the midtones (differs from linear)", async () => {
  const w = 64;
  const p = await tmpImage("grad3", w, 8, (x) => Math.round((x / (w - 1)) * 255));
  const linear = await imageToAsciiLines(p, { maxWidth: 40, gamma: 1 });
  const gamma = await imageToAsciiLines(p, { maxWidth: 40, gamma: 0.4 });
  assert.notEqual(linear.join("\n"), gamma.join("\n"));
  await fs.unlink(p);
});

test("width is capped at maxWidth", async () => {
  const p = await tmpImage("box", 100, 100, () => 128);
  const lines = await imageToAsciiLines(p, { maxWidth: 30, autoContrast: false });
  const cols = Math.max(...lines.map((l) => l.length));
  assert.ok(cols <= 30, `cols ${cols} should be <= 30`);
  await fs.unlink(p);
});

test("ordered dither mixes a 2-char ramp on flat gray", async () => {
  // Flat mid-gray + a 2-level ramp: nearest-level maps to one char everywhere,
  // so ordered dither must mix both chars to fake the tone.
  const p = await tmpImage("flat", 16, 16, () => 128);
  const none = await imageToAsciiLines(p, {
    maxWidth: 16,
    ramp: " #",
    autoContrast: false,
    dither: "none",
  });
  const bayer = await imageToAsciiLines(p, {
    maxWidth: 16,
    ramp: " #",
    autoContrast: false,
    dither: "bayer",
  });
  assert.equal(new Set(none.join("")).size, 1, "flat gray -> one char without dither");
  const chars = new Set(bayer.join(""));
  assert.ok(chars.has(" ") && chars.has("#"), "bayer mixes both ramp chars");
  await fs.unlink(p);
});

test("floyd dither differs from plain mapping on a gradient", async () => {
  const w = 64;
  const p = await tmpImage("fgrad", w, 16, (x) => Math.round((x / (w - 1)) * 255));
  const none = await imageToAsciiLines(p, { maxWidth: 40, dither: "none" });
  const floyd = await imageToAsciiLines(p, { maxWidth: 40, dither: "floyd" });
  assert.notEqual(none.join("\n"), floyd.join("\n"));
  await fs.unlink(p);
});

const isBraille = (s) => [...s].every((c) => {
  const cp = c.codePointAt(0);
  return cp >= 0x2800 && cp <= 0x28ff;
});

test("braille output is all braille glyphs at the requested cell width", async () => {
  const p = await tmpImage("bgrad", 80, 40, (x, _y, ww) => Math.round((x / (ww - 1)) * 255));
  const lines = await imageToBrailleLines(p, { maxWidth: 32 });
  assert.ok(lines.length >= 1);
  assert.ok(lines.every((l) => l.length === 32), "every row is exactly max_width cells");
  assert.ok(isBraille(lines.join("")), "every glyph is in the braille block");
  await fs.unlink(p);
});

test("braille sub-pixel: solid black/white map to empty/full cells", async () => {
  // Left half white (ink), right half black -> left cells full (all 8 dots),
  // right cells empty. dither='none' keeps the hard edge crisp.
  const p = await tmpImage("bsplit", 40, 20, (x, _y, ww) => (x < ww / 2 ? 255 : 0));
  const lines = await imageToBrailleLines(p, { maxWidth: 20, dither: "none", autoContrast: false });
  const row = lines[Math.floor(lines.length / 2)];
  assert.equal(row[0].codePointAt(0), 0x28ff, "bright side -> full cell (all dots)");
  assert.equal(row[row.length - 1].codePointAt(0), 0x2800, "dark side -> empty cell");
  await fs.unlink(p);
});

test("braille resolves a thin feature without flooding (sub-pixel)", async () => {
  // A narrow vertical white stripe on black, thinner than the rendered output is
  // wide. Braille must light the stripe's dots while leaving the rest empty —
  // the feature neither vanishes nor floods the whole grid.
  const w = 48;
  const c = Math.floor(w / 2);
  const p = await tmpImage("bstripe", w, 12, (x) => (Math.abs(x - c) <= 1 ? 255 : 0));
  const lines = await imageToBrailleLines(p, { maxWidth: 12, dither: "none" });
  const joined = lines.join("");
  assert.ok([...joined].some((ch) => ch.codePointAt(0) > 0x2800), "stripe lit some dots");
  assert.ok([...joined].some((ch) => ch.codePointAt(0) === 0x2800), "background stayed empty");
  await fs.unlink(p);
});

test("braille edges outline the seam, leaving flat interiors empty", async () => {
  // Hard left(white)/right(black) split. Tonal mode fills the white half; edges
  // mode leaves both flat interiors empty and lights only the boundary seam.
  const p = await tmpImage("bedge", 40, 20, (x, _y, ww) => (x < ww / 2 ? 255 : 0));
  const tonal = await imageToBrailleLines(p, { maxWidth: 20, dither: "none", autoContrast: false });
  const outline = await imageToBrailleLines(p, { maxWidth: 20, edges: true });
  const mid = Math.floor(outline.length / 2);
  // Flat interiors carry no gradient, so far-left and far-right cells stay empty.
  assert.equal(outline[mid][0].codePointAt(0), 0x2800, "flat white interior is empty in edge mode");
  assert.equal(outline[mid][outline[mid].length - 1].codePointAt(0), 0x2800, "flat black interior is empty");
  // Tonal mode, by contrast, fills that same white interior.
  assert.equal(tonal[mid][0].codePointAt(0), 0x28ff, "tonal mode fills the white interior");
  // The seam itself lights dots.
  assert.ok([...outline.join("")].some((c) => c.codePointAt(0) > 0x2800), "the seam is drawn");
  await fs.unlink(p);
});

test("braille invert flips ink from bright to dark pixels", async () => {
  const p = await tmpImage("binv", 40, 20, (x, _y, ww) => (x < ww / 2 ? 255 : 0));
  const plain = await imageToBrailleLines(p, { maxWidth: 20, dither: "none", autoContrast: false });
  const inv = await imageToBrailleLines(p, { maxWidth: 20, dither: "none", autoContrast: false, invert: true });
  const mid = Math.floor(plain.length / 2);
  assert.equal(plain[mid][0].codePointAt(0), 0x28ff);
  assert.equal(inv[mid][0].codePointAt(0), 0x2800, "invert empties the bright side");
  assert.equal(inv[mid][inv[mid].length - 1].codePointAt(0), 0x28ff, "invert fills the dark side");
  await fs.unlink(p);
});

test("edges draws directional strokes on a hard boundary", async () => {
  // Left half black, right half white -> a strong vertical edge down the middle.
  const p = await tmpImage("step", 40, 20, (x, _y, ww) => (x < ww / 2 ? 0 : 255));
  const lines = await imageToAsciiLines(p, {
    maxWidth: 40,
    edges: true,
    edgeThreshold: 0.1,
  });
  assert.ok(/[|\-/\\]/.test(lines.join("")), "expected at least one edge stroke");
  await fs.unlink(p);
});
