// Tests for the block_diagram engine (labeled boxes joined by connectors).
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockDiagram } from "../dist/diagram.js";

test("empty input yields no lines", () => {
  assert.deepEqual(blockDiagram([]), []);
  assert.deepEqual(blockDiagram(["", "  "].map((s) => s.trim())), []);
});

test("a vertical stack draws one box per block, all the same width", () => {
  const out = blockDiagram(["Attention", "Add & Norm", "Feed Forward"], {
    style: "unicode",
  });
  const tops = out.filter((l) => l.includes("╭")).length;
  assert.equal(tops, 3, "one rounded top border per block");
  // Every border line is the same width -> the boxes align.
  const borderWidths = out
    .filter((l) => /[╭╰]/.test(l))
    .map((l) => [...l].length);
  assert.equal(new Set(borderWidths).size, 1, "uniform box width");
  assert.ok(out.join("\n").includes("Feed Forward"), "labels are rendered");
});

test("down-flow puts an arrowhead between boxes; up-flow reverses and points up", () => {
  const down = blockDiagram(["A", "B"], { style: "unicode", direction: "down" });
  const up = blockDiagram(["A", "B"], { style: "unicode", direction: "up" });
  assert.ok(down.some((l) => l.includes("▼")), "down flow has ▼");
  assert.ok(up.some((l) => l.includes("▲")), "up flow has ▲");
  // "up" reverses order: the last label ends up on top.
  const firstLabelRow = up.findIndex((l) => /[AB]/.test(l));
  assert.ok(up[firstLabelRow].includes("B"), "up flow renders B first (on top)");
});

test("horizontal flow lays boxes side by side with a right arrow", () => {
  const out = blockDiagram(["Tokens", "Embed", "Logits"], {
    direction: "right",
    style: "ascii",
    gap: 3,
  });
  const body = out.join("\n");
  assert.ok(body.includes("-->"), "ascii right arrow between boxes");
  // All three labels share one row (side by side, not stacked).
  const labelRow = out.find((l) => l.includes("Tokens"));
  assert.ok(
    labelRow.includes("Embed") && labelRow.includes("Logits"),
    "boxes are on the same row",
  );
});

test("ascii style stays within 7-bit characters", () => {
  const out = blockDiagram(["One", "Two"], { style: "ascii" }).join("");
  for (const ch of out)
    assert.ok(ch.charCodeAt(0) < 128, `non-ascii char: ${JSON.stringify(ch)}`);
});

test("a title is centered above the figure", () => {
  const out = blockDiagram(["Encoder"], { title: "My Model", style: "ascii" });
  assert.ok(out[0].includes("My Model"), "title on the first line");
  assert.equal(out[1], "", "blank line under the title");
  assert.ok(out.slice(2).some((l) => l.includes("Encoder")), "figure follows");
});

test("a multi-line label makes a taller box", () => {
  const one = blockDiagram(["Attention"], { style: "ascii", connector: "none" });
  const two = blockDiagram(["Multi-Head\nAttention"], {
    style: "ascii",
    connector: "none",
  });
  assert.ok(two.length > one.length, "two label lines -> a taller box");
  assert.ok(two.join("\n").includes("Multi-Head"), "first line present");
  assert.ok(two.join("\n").includes("Attention"), "second line present");
});

test("gap controls the connector length", () => {
  const g1 = blockDiagram(["A", "B"], { gap: 1, style: "ascii" });
  const g3 = blockDiagram(["A", "B"], { gap: 3, style: "ascii" });
  assert.ok(g3.length > g1.length, "a larger gap makes a taller diagram");
});
