// Tests for the draw_icon library (pictograms rendered as braille line-art).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_NAMES, iconToBrailleLines } from "../dist/icons.js";

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
// Total lit braille dots across all cells (each glyph packs up to 8).
const litDots = (lines) =>
  [...lines.join("")].reduce((n, c) => n + popcount(c.codePointAt(0) - 0x2800), 0);

test("ICON_NAMES is a non-empty, sorted, unique list", () => {
  assert.ok(ICON_NAMES.length >= 10, "a useful library has many icons");
  const sorted = [...ICON_NAMES].sort();
  assert.deepEqual(ICON_NAMES, sorted, "names are alphabetical");
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length, "no duplicates");
});

test("every icon renders the right size, all-braille, with visible ink", () => {
  const cols = 20;
  const rows = Math.round(cols / 2);
  for (const name of ICON_NAMES) {
    const lines = iconToBrailleLines(name, cols);
    assert.equal(lines.length, rows, `${name}: row count`);
    assert.ok(
      lines.every((l) => [...l].length === cols),
      `${name}: every row is exactly ${cols} cells`,
    );
    assert.ok(isBraille(lines.join("")), `${name}: only braille glyphs`);
    assert.ok(litDots(lines) > 12, `${name}: draws visible ink`);
  }
});

test("filled icons produce at least one fully-solid cell", () => {
  for (const name of ["star", "heart"]) {
    const glyphs = [...iconToBrailleLines(name, 24).join("")];
    assert.ok(
      glyphs.some((c) => c.codePointAt(0) === 0x28ff),
      `${name}: a filled shape should have a solid (all-8-dot) cell`,
    );
  }
});

test("an unknown icon name throws with the known list", () => {
  assert.throws(() => iconToBrailleLines("banana", 16), /unknown icon .*banana/);
});

test("invert swaps ink and paper (a blank corner fills in)", () => {
  const plain = iconToBrailleLines("star", 20);
  const inv = iconToBrailleLines("star", 20, { invert: true });
  // The top-left corner is empty paper for a centered star.
  assert.equal(plain[0][0].codePointAt(0), 0x2800, "corner is blank normally");
  assert.equal(inv[0][0].codePointAt(0), 0x28ff, "corner is solid when inverted");
});

test("heavier weight lays down more ink", () => {
  const thin = litDots(iconToBrailleLines("magnifier", 24, { weight: 1 }));
  const thick = litDots(iconToBrailleLines("magnifier", 24, { weight: 2.5 }));
  assert.ok(thick > thin, `thick (${thick}) should out-ink thin (${thin})`);
});

test("size scales the rendered grid", () => {
  const small = iconToBrailleLines("gear", 12);
  const big = iconToBrailleLines("gear", 40);
  assert.equal(small.length, 6);
  assert.equal(big.length, 20);
  assert.equal([...big[0]].length, 40);
});
