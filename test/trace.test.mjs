// Tests for traceToBrailleLines: turning flat two-tone art (SVG/PNG/logos) into
// crisp braille icons by flattening transparency and hard-thresholding dark ink.
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { traceToBrailleLines } from "../dist/image.js";

const isBraille = (c) => {
  const cp = c.codePointAt(0);
  return cp >= 0x2800 && cp <= 0x28ff;
};
const popcount = (v) => {
  let n = 0;
  while (v) {
    n += v & 1;
    v >>= 1;
  }
  return n;
};
const litDots = (lines) =>
  [...lines.join("")].reduce((n, c) => n + popcount(c.codePointAt(0) - 0x2800), 0);

// Opaque grayscale PNG: fn(x, y) -> 0..255.
async function tmpGray(name, w, h, fn) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y) & 0xff;
      const i = (y * w + x) * 3;
      buf[i] = buf[i + 1] = buf[i + 2] = v;
    }
  }
  const p = path.join(os.tmpdir(), `glyph-trace-${name}-${process.pid}.png`);
  await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toFile(p);
  return p;
}

// RGBA PNG: fn(x, y) -> [r, g, b, a].
async function tmpRGBA(name, w, h, fn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * w + x) * 4;
      buf[i] = r & 0xff;
      buf[i + 1] = g & 0xff;
      buf[i + 2] = b & 0xff;
      buf[i + 3] = a & 0xff;
    }
  }
  const p = path.join(os.tmpdir(), `glyph-trace-${name}-${process.pid}.png`);
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(p);
  return p;
}

// A dark square centered on a white field.
const centeredSquare = (w, h) => (x, y) => {
  const inside =
    x > w * 0.3 && x < w * 0.7 && y > h * 0.3 && y < h * 0.7;
  return inside ? 0 : 255;
};

test("trace renders all-braille lines at the requested width", async () => {
  const p = await tmpGray("box", 80, 80, centeredSquare(80, 80));
  const lines = await traceToBrailleLines(p, { maxWidth: 20 });
  assert.equal([...lines[0]].length, 20, "width in cells matches maxWidth");
  assert.ok(lines.length >= 8, "a square source is roughly as tall as it is wide");
  assert.ok(isBraille(lines.join("")), "only braille glyphs");
  assert.ok(litDots(lines) > 8, "the dark square leaves visible ink");
});

test("dark ink becomes ink and the white margin stays blank paper", async () => {
  const p = await tmpGray("box2", 80, 80, centeredSquare(80, 80));
  const lines = await traceToBrailleLines(p, { maxWidth: 20 });
  assert.equal(lines[0][0].codePointAt(0), 0x2800, "top-left corner is blank paper");
  const mid = lines[Math.floor(lines.length / 2)];
  const midCell = [...mid][Math.floor(mid.length / 2)];
  assert.ok(midCell.codePointAt(0) > 0x2800, "the centre sits on dark ink");
});

test("invert swaps ink and paper", async () => {
  const p = await tmpGray("box3", 80, 80, centeredSquare(80, 80));
  const plain = await traceToBrailleLines(p, { maxWidth: 20 });
  const inv = await traceToBrailleLines(p, { maxWidth: 20, invert: true });
  assert.equal(plain[0][0].codePointAt(0), 0x2800, "corner blank normally");
  assert.equal(inv[0][0].codePointAt(0), 0x28ff, "corner solid when inverted");
  assert.ok(litDots(inv) > litDots(plain), "inverting a small mark floods the field");
});

test("grow dilates thin line art into more ink", async () => {
  // A single dark vertical hairline down the middle of a white field.
  const p = await tmpGray("hairline", 80, 80, (x) => (Math.abs(x - 40) <= 1 ? 0 : 255));
  const thin = await traceToBrailleLines(p, { maxWidth: 20, grow: 0 });
  const thick = await traceToBrailleLines(p, { maxWidth: 20, grow: 2 });
  assert.ok(litDots(thin) > 0, "the hairline traces to some ink");
  assert.ok(litDots(thick) > litDots(thin), `grow (${litDots(thick)}) out-inks faithful (${litDots(thin)})`);
});

test("transparency flattens to paper so only opaque ink survives", async () => {
  // Transparent everywhere except a dark opaque disk in the centre. A tonal
  // reader would misjudge the transparent ground; the tracer flattens it white.
  const p = await tmpRGBA("disk", 80, 80, (x, y) => {
    const dx = x - 40;
    const dy = y - 40;
    const inDisk = dx * dx + dy * dy < 18 * 18;
    return inDisk ? [10, 10, 10, 255] : [0, 0, 0, 0];
  });
  const lines = await traceToBrailleLines(p, { maxWidth: 20 });
  assert.equal(lines[0][0].codePointAt(0), 0x2800, "transparent corner reads as blank paper");
  const mid = lines[Math.floor(lines.length / 2)];
  const midCell = [...mid][Math.floor(mid.length / 2)];
  assert.ok(midCell.codePointAt(0) > 0x2800, "the opaque disk survives as ink");
});
