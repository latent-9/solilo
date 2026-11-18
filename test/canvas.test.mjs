// Tests for the ASCII grid engine. Run via `npm test` (builds to dist/ first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AsciiCanvas } from "../dist/canvas.js";

test("setChar / getChar respect bounds", () => {
  const c = new AsciiCanvas(5, 3);
  c.setChar(1, 1, "X");
  assert.equal(c.getChar(1, 1), "X");
  c.setChar(-1, 0, "Y"); // out of bounds writes are no-ops
  c.setChar(99, 0, "Y");
  assert.equal(c.getChar(99, 0), " "); // out of bounds reads are a space
});

test("drawText writes a horizontal run", () => {
  const c = new AsciiCanvas(10, 1);
  c.drawText(2, 0, "hi");
  assert.equal(c.getChar(2, 0), "h");
  assert.equal(c.getChar(3, 0), "i");
});

test("drawBlock places multiple rows", () => {
  const c = new AsciiCanvas(4, 3);
  c.drawBlock(0, 0, "ab\ncd");
  assert.equal(c.getChar(0, 0), "a");
  assert.equal(c.getChar(1, 1), "d");
});

test("drawBlock overwrites with spaces by default (opaque)", () => {
  const c = new AsciiCanvas(4, 1);
  c.drawText(0, 0, "####");
  c.drawBlock(1, 0, "X X"); // the two spaces should erase the # beneath
  assert.equal(c.getChar(0, 0), "#");
  assert.equal(c.getChar(1, 0), "X");
  assert.equal(c.getChar(2, 0), " ", "space overwrote the background");
  assert.equal(c.getChar(3, 0), "X");
});

test("drawBlock transparent skips blank cells so layers compose", () => {
  const c = new AsciiCanvas(4, 1);
  c.drawText(0, 0, "####");
  c.drawBlock(1, 0, "X X", true); // spaces are transparent now
  assert.equal(c.getChar(1, 0), "X");
  assert.equal(c.getChar(2, 0), "#", "background survives under a transparent space");
  assert.equal(c.getChar(3, 0), "X");
});

test("drawBlock transparent also treats the braille-blank as transparent", () => {
  const c = new AsciiCanvas(3, 1);
  c.drawText(0, 0, "###");
  c.drawBlock(0, 0, "⠉⠀⠉", true); // braille glyph, blank, glyph
  assert.equal(c.getChar(0, 0), "⠉");
  assert.equal(c.getChar(1, 0), "#", "braille-blank U+2800 is transparent");
  assert.equal(c.getChar(2, 0), "⠉");
});

test("drawLine hits both endpoints", () => {
  const c = new AsciiCanvas(5, 1);
  c.drawLine(0, 0, 4, 0, "#");
  for (let x = 0; x < 5; x++) assert.equal(c.getChar(x, 0), "#");
});

test("drawRect outline leaves the interior empty; filled does not", () => {
  const o = new AsciiCanvas(5, 5);
  o.drawRect(0, 0, 5, 5, "#", false);
  assert.equal(o.getChar(0, 0), "#");
  assert.equal(o.getChar(2, 2), " ");
  const f = new AsciiCanvas(5, 5);
  f.drawRect(0, 0, 5, 5, "#", true);
  assert.equal(f.getChar(2, 2), "#");
});

test("fillGradient maps the span ends to the ramp ends", () => {
  const c = new AsciiCanvas(10, 1);
  const ramp = " .:-=+*#%@";
  c.fillGradient(0, 0, 10, 1, ramp, "right");
  assert.equal(c.getChar(0, 0), ramp[0]);
  assert.equal(c.getChar(9, 0), ramp[ramp.length - 1]);
});

test("scatter fills only empty cells and honors density extremes", () => {
  const c = new AsciiCanvas(4, 1);
  c.setChar(0, 0, "#");
  c.scatter(0, 0, 4, 1, "*", 1); // density 1 fills every empty cell
  assert.equal(c.getChar(0, 0), "#"); // an existing char is left alone
  assert.equal(c.getChar(1, 0), "*");
  const z = new AsciiCanvas(4, 1);
  z.scatter(0, 0, 4, 1, "*", 0); // density 0 fills nothing
  assert.equal(z.isEmpty(), true);
});

test("render trims trailing space; toTrimmedText crops to content", () => {
  const c = new AsciiCanvas(6, 3);
  c.setChar(2, 1, "X");
  assert.equal(c.toTrimmedText(), "X");
  assert.equal(c.isEmpty(), false);
  const e = new AsciiCanvas(3, 2);
  assert.equal(e.isEmpty(), true);
});

test("erase clears a cell", () => {
  const c = new AsciiCanvas(3, 1);
  c.setChar(1, 0, "Z");
  c.erase(1, 0);
  assert.equal(c.getChar(1, 0), " ");
});

test("trim shrinks the canvas to hug the content", () => {
  const c = new AsciiCanvas(10, 6);
  c.setChar(3, 2, "A");
  c.setChar(5, 4, "B");
  const size = c.trim();
  assert.deepEqual(size, { width: 3, height: 3 }); // columns 3..5, rows 2..4
  assert.equal(c.width, 3);
  assert.equal(c.height, 3);
  assert.equal(c.getChar(0, 0), "A"); // content moved to the top-left
  assert.equal(c.getChar(2, 2), "B");
});

test("trim keeps a pad border and collapses a blank canvas to 1x1", () => {
  const c = new AsciiCanvas(8, 8);
  c.setChar(4, 4, "X");
  c.trim(1);
  assert.equal(c.width, 3);
  assert.equal(c.height, 3);
  assert.equal(c.getChar(1, 1), "X"); // centered inside a 1-cell blank border
  const blank = new AsciiCanvas(6, 4);
  blank.trim();
  assert.equal(blank.width, 1);
  assert.equal(blank.height, 1);
});

test("trim treats the braille-blank as margin", () => {
  const c = new AsciiCanvas(5, 3);
  c.drawText(0, 0, "⠀⠀⣿⠀"); // braille glyph padded with braille-blanks
  c.trim();
  assert.equal(c.width, 1);
  assert.equal(c.height, 1);
  assert.equal(c.getChar(0, 0), "⣿");
});

test("flip horizontal reverses rows and swaps mirror glyphs", () => {
  const c = new AsciiCanvas(3, 1);
  c.drawText(0, 0, "/(a"); // note: 'a' is a letter -> unchanged
  c.flip("horizontal");
  // reversed order is a ( / -> then swap: ( -> ), / -> \
  assert.equal(c.getChar(0, 0), "a");
  assert.equal(c.getChar(1, 0), ")");
  assert.equal(c.getChar(2, 0), "\\");
});

test("flip vertical reverses row order and swaps slashes", () => {
  const c = new AsciiCanvas(1, 2);
  c.setChar(0, 0, "/");
  c.setChar(0, 1, "X");
  c.flip("vertical");
  assert.equal(c.getChar(0, 0), "X"); // bottom row came up top
  assert.equal(c.getChar(0, 1), "\\"); // '/' moved down and mirrored
});

test("flip swaps box corners so a frame stays coherent", () => {
  const c = new AsciiCanvas(2, 1);
  c.drawText(0, 0, "┌┐");
  c.flip("horizontal");
  assert.equal(c.getChar(0, 0), "┌"); // ┐ reversed to front then mirrored back to ┌
  assert.equal(c.getChar(1, 0), "┐");
});

test("resize grows with top-left anchor, padding blanks", () => {
  const c = new AsciiCanvas(2, 1);
  c.drawText(0, 0, "AB");
  c.resize(4, 2, "top-left");
  assert.equal(c.width, 4);
  assert.equal(c.height, 2);
  assert.equal(c.getChar(0, 0), "A");
  assert.equal(c.getChar(1, 0), "B");
  assert.equal(c.getChar(3, 1), " "); // new area is blank
});

test("resize centers content and shrinking crops the overflow", () => {
  const c = new AsciiCanvas(1, 1);
  c.setChar(0, 0, "X");
  c.resize(3, 3, "center");
  assert.equal(c.getChar(1, 1), "X"); // held in the middle
  const big = new AsciiCanvas(5, 1);
  big.drawText(0, 0, "abcde");
  big.resize(3, 1, "top-left"); // shrink keeps the left three
  assert.equal(big.width, 3);
  assert.equal(big.getChar(0, 0), "a");
  assert.equal(big.getChar(2, 0), "c");
});

test("frame wraps the canvas with a border and centers a title", () => {
  const c = new AsciiCanvas(3, 1);
  c.drawText(0, 0, "hi!");
  const size = c.frame("unicode", "", 0);
  assert.deepEqual(size, { width: 5, height: 3 }); // grew by 1 on each side
  assert.equal(c.getChar(0, 0), "┌");
  assert.equal(c.getChar(4, 0), "┐");
  assert.equal(c.getChar(0, 2), "└");
  assert.equal(c.getChar(4, 2), "┘");
  assert.equal(c.getChar(1, 1), "h"); // content shifted inside the border
  assert.equal(c.getChar(3, 1), "!");
});

test("frame title lands centered on the top edge", () => {
  const c = new AsciiCanvas(9, 1);
  c.frame("ascii", "ok", 0);
  const top = c.render().split("\n")[0];
  assert.ok(top.includes(" ok "), `title in top edge: ${top}`);
  assert.equal(top[0], "+"); // ascii corners/edges
  assert.ok(top.includes("-"));
});

test("frame padding inserts a blank ring between art and border", () => {
  const c = new AsciiCanvas(1, 1);
  c.setChar(0, 0, "X");
  c.frame("unicode", "", 1); // 1 border + 1 pad on each side -> +4
  assert.equal(c.width, 5);
  assert.equal(c.height, 5);
  assert.equal(c.getChar(2, 2), "X"); // dead center
  assert.equal(c.getChar(1, 1), " "); // padding cell, not the border
  assert.equal(c.getChar(0, 0), "┌"); // border still on the outer edge
});

test("crop cuts a window and pads out-of-range cells with spaces", () => {
  const c = new AsciiCanvas(6, 3);
  c.drawText(0, 0, "abcdef");
  c.crop(2, 0, 3, 1); // keep columns 2..4
  assert.equal(c.width, 3);
  assert.equal(c.height, 1);
  assert.equal(c.getChar(0, 0), "c");
  assert.equal(c.getChar(2, 0), "e");
  const d = new AsciiCanvas(3, 1);
  d.drawText(0, 0, "xyz");
  d.crop(2, 0, 3, 1); // window runs past the right edge
  assert.equal(d.getChar(0, 0), "z");
  assert.equal(d.getChar(1, 0), " "); // out of range -> blank
});
