// Tests for restyle_ascii: re-mapping existing ASCII art onto a new palette.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  restyleAscii,
  charCoverage,
  RAMPS,
  BLOCKS_RAMP,
  BRAILLE_RAMP,
  DENSITY_RAMP,
} from "../dist/image.js";

test("blocks and braille ramps are registered and start blank", () => {
  assert.equal(RAMPS.blocks, BLOCKS_RAMP);
  assert.equal(RAMPS.braille, BRAILLE_RAMP);
  // The empty end must be a real space so restyled backgrounds stay blank.
  assert.equal([...BLOCKS_RAMP][0], " ");
  assert.equal([...BRAILLE_RAMP][0], " ");
  assert.ok([...BLOCKS_RAMP].length >= 2);
  assert.ok([...BRAILLE_RAMP].length >= 2);
});

test("coverage ranks heavier glyphs above lighter ones", () => {
  assert.ok(charCoverage("@") > charCoverage("."));
  assert.ok(charCoverage("#") > charCoverage(":"));
  assert.equal(charCoverage(" "), 0);
  assert.equal(charCoverage("█"), 1);
});

test("density remap preserves shape and blanks", () => {
  const art = ["  @@  ", " @..@ ", "  @@  "].join("\n");
  const out = restyleAscii(art, { ramp: BLOCKS_RAMP });
  // Same number of rows; spaces stay spaces (structure preserved).
  assert.equal(out.length, 3);
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < art.split("\n")[y].length; x++) {
      const src = art.split("\n")[y][x];
      const dst = out[y][x] ?? " ";
      if (src === " ") assert.equal(dst, " ", `blank at ${x},${y}`);
    }
  }
  // The heaviest source glyph maps to the heaviest block.
  const full = [...BLOCKS_RAMP][[...BLOCKS_RAMP].length - 1];
  assert.ok(out.join("").includes(full), "expected a solid block for '@'");
});

test("explicit map substitutes exactly and skips density remap", () => {
  const art = "@#.\n.#@";
  const out = restyleAscii(art, { map: { "@": "O", "#": "x" } });
  assert.equal(out[0], "Ox.");
  assert.equal(out[1], ".xO");
});

test("invert flips drawn glyphs but keeps background blank", () => {
  // Use light glyphs ('.') so that inverting makes them heavy ink — the row
  // stays non-empty and we can check the leading background space survives.
  const art = " .. ";
  const plain = restyleAscii(art, { ramp: DENSITY_RAMP });
  const inv = restyleAscii(art, { ramp: DENSITY_RAMP, invert: true });
  assert.notEqual(plain.join("\n"), inv.join("\n"));
  assert.equal(inv[0][0], " ", "leading background space is preserved");
  assert.ok(inv[0].trim().length > 0, "inverted light glyphs become heavy ink");
});
