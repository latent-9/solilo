// Tests for the banner engine (a phrase rendered as big block letters).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bannerText } from "../dist/banner.js";

test("a single-line phrase renders exactly 5 rows of ink", () => {
  const out = bannerText("HI");
  assert.equal(out.length, 5, "font height is 5");
  assert.ok(out.join("").includes("█"), "unicode ink block present by default");
});

test("style picks the ink charset", () => {
  assert.ok(bannerText("A", { style: "unicode" }).join("").includes("█"));
  const ascii = bannerText("A", { style: "ascii" }).join("");
  assert.ok(ascii.includes("#"), "ascii ink is #");
  assert.ok(!ascii.includes("█"), "no unicode block in ascii mode");
});

test("fill overrides the style ink", () => {
  const out = bannerText("A", { fill: "*" }).join("");
  assert.ok(out.includes("*"), "custom ink used");
  assert.ok(!out.includes("█") && !out.includes("#"), "no default ink leaks through");
});

test("gap widens the space between letters", () => {
  const narrow = Math.max(...bannerText("HI", { gap: 1 }).map((l) => l.length));
  const wide = Math.max(...bannerText("HI", { gap: 6 }).map((l) => l.length));
  assert.ok(wide > narrow, "a larger gap produces wider output");
});

test("lowercase is upper-cased (same output as uppercase)", () => {
  assert.deepEqual(bannerText("glyph"), bannerText("GLYPH"));
});

test("an unknown character renders blank without throwing", () => {
  const out = bannerText("A~B", { style: "ascii" });
  assert.equal(out.length, 5);
  // The tilde has no glyph, so it contributes only blanks — A and B still ink.
  assert.ok(out.join("").includes("#"));
});

test("a newline stacks two banner rows with a blank separator", () => {
  const out = bannerText("A\nB");
  assert.equal(out.length, 11, "5 + blank + 5");
  assert.equal(out[5], "", "blank line between the two blocks");
});

test("every A-Z and 0-9 has a glyph that renders ink", () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (const ch of chars) {
    const out = bannerText(ch, { style: "ascii" }).join("");
    assert.ok(out.includes("#"), `no ink rendered for "${ch}"`);
  }
});

test("rows are right-trimmed (no trailing whitespace)", () => {
  for (const line of bannerText("GO")) {
    assert.equal(line, line.replace(/\s+$/, ""), "no trailing spaces");
  }
});
