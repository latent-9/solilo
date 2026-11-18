// Tests for the deterministic natural-language front-end (`describe`): a short
// phrase must map to the right motif(s) + parameters with no model and no
// network, and the rendered SVG must stay in the engine's stroke-free palette.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpret,
  illustrateFromPrompt,
} from "../dist/describe.js";
import { INK, PAPER, ACCENTS } from "../dist/illustrate.js";

const PALETTE = new Set([INK, PAPER, ...Object.values(ACCENTS)]);
const fillsOf = (svg) => [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);

test("a bare motif word yields a single-motif plan", () => {
  const it = interpret("a gear");
  assert.equal(it.kind, "single");
  assert.equal(it.motif, "gear");
  assert.deepEqual(it.motifs, ["gear"]);
});

test("everyday synonyms resolve to the right motif", () => {
  assert.equal(interpret("a cog").motif, "gear");
  assert.equal(interpret("some lightning").motif, "bolt");
  assert.equal(interpret("a magnifying glass").motif, "magnifier");
  assert.equal(interpret("a speech bubble").motif, "chat");
  assert.equal(interpret("a robot").motif, "robot");
  assert.equal(interpret("a mic").motif, "microphone");
  assert.equal(interpret("a podcast").motif, "microphone");
  assert.equal(interpret("a scale").motif, "balance");
  assert.equal(interpret("justice").motif, "balance");
  assert.equal(interpret("a critter").motif, "golem");
  assert.equal(interpret("a mascot").motif, "golem");
  assert.equal(interpret("an alien").motif, "alien");
  assert.equal(interpret("a ufo").motif, "alien");
  assert.equal(interpret("an octopus").motif, "octopus");
  assert.equal(interpret("a squid").motif, "octopus");
});

test("two or more motifs become a scene", () => {
  const it = interpret("gear and spark");
  assert.equal(it.kind, "scene");
  assert.deepEqual(it.motifs, ["gear", "spark"]);
  assert.equal(it.layout, "focal", "a scene defaults to focal, the hero-and-satellites arrangement");
});

test("layout cues are understood", () => {
  assert.equal(interpret("gear and spark in a row").layout, "row");
  assert.equal(interpret("gear next to spark").layout, "row");
  assert.equal(interpret("gear and spark in a column").layout, "column");
  assert.equal(interpret("gear and spark scattered").layout, "scatter");
  assert.equal(interpret("a chip surrounded by gears").layout, "focal");
  assert.equal(interpret("a spark orbiting a brain").layout, "focal");
});

test("data motifs resolve by name and by everyday synonyms", () => {
  assert.equal(interpret("a gauge").motif, "gauge");
  assert.equal(interpret("a candlestick chart").motif, "candles");
  assert.equal(interpret("a speedometer").motif, "gauge");
  assert.equal(interpret("a bar chart").motif, "barchart");
  // "scatter" is a layout word, so the plot is reached by its full name.
  assert.equal(interpret("a scatterplot").motif, "scatterplot");
});

test("colour words and an explicit #hex set the accent", () => {
  assert.equal(interpret("a blue robot").accentColor, "blue");
  assert.equal(interpret("a green leaf").accentColor, "green");
  // orange is the clay family; a hex wins over any name.
  assert.equal(interpret("an orange gear").accentColor, "clay");
  assert.equal(interpret("a heart in #33aa88").accentColor, "#33aa88");
});

test("line-style words set roughness/weight/sketch", () => {
  assert.equal(interpret("a rough gear").roughness, 2.6);
  assert.equal(interpret("a clean gear").roughness, 0);
  assert.equal(interpret("a bold gear").weight, 2);
  assert.equal(interpret("a thin gear").weight, 0.5);
  assert.equal(interpret("a sketchy gear").sketch, true);
});

test("backdrop and accent-toggle cues are understood", () => {
  assert.equal(interpret("a spark on dark").invert, true);
  assert.equal(interpret("a spark, transparent").background, "none");
  assert.equal(interpret("a monochrome gear").accent, false);
});

test('"hand drawn" restyles without eating the hand motif', () => {
  // The phrase must set the rough style, not resolve to the `hand` motif...
  const styled = interpret("a hand drawn gear");
  assert.equal(styled.motif, "gear");
  assert.equal(styled.roughness, 2.6);
  // ...yet a real hand is still reachable.
  assert.equal(interpret("a hand").motif, "hand");
});

test("grid/row/column read as layout, not the grid motif", () => {
  const it = interpret("gear and spark grid");
  assert.equal(it.layout, "grid");
  assert.deepEqual(it.motifs, ["gear", "spark"], "no stray grid motif");
});

test("a phrase with no motif throws a helpful error", () => {
  assert.throws(() => interpret("a wombat waltzing"), /Could not find a motif/);
});

test("interpretation is deterministic; the seed is stable per phrase", () => {
  assert.deepEqual(interpret("a blue gear"), interpret("a blue gear"), "same phrase -> same plan");
  assert.notEqual(
    interpret("a gear").seed,
    interpret("a spark").seed,
    "different phrases -> different seed",
  );
  const forced = interpret("a gear", { seed: 42 });
  assert.equal(forced.seed, 42, "an explicit seed overrides the phrase hash");
});

test("a single-motif prompt renders a stroke-free, in-palette SVG", () => {
  const { svg } = illustrateFromPrompt("a bold blue robot");
  assert.match(svg, /^<svg /);
  assert.ok(!/stroke/.test(svg) && !/NaN/.test(svg), "clean output");
  for (const f of fillsOf(svg)) {
    if (f === "none") continue;
    assert.ok(PALETTE.has(f), `fill ${f} in palette`);
  }
});

test("a multi-motif prompt renders one composed plate", () => {
  const { svg, interpretation } = illustrateFromPrompt("gear, spark and atom in a grid");
  assert.equal(interpretation.kind, "scene");
  assert.equal((svg.match(/<g transform=/g) ?? []).length, 3, "one group per motif");
  assert.ok(!/stroke/.test(svg), "no strokes");
});
