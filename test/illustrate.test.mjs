// Tests for the `illustrate` engine: every motif must emit a valid SVG in the
// blog's exact envelope (root fill="none", no strokes, only the three palette
// inks), and the procedural wobble must be deterministic per seed.
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  illustrate,
  compose,
  rasterize,
  hatch,
  stipple,
  dashed,
  MOTIF_NAMES,
  ACCENTS,
  INK,
  PAPER,
  CLAY,
  CLAY_DARK,
  BLUE,
} from "../dist/illustrate.js";

const PALETTE = new Set([INK, PAPER, ...Object.values(ACCENTS)]);
const fillsOf = (svg) => [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);

test("every motif emits a valid, stroke-free SVG in the palette", () => {
  assert.ok(MOTIF_NAMES.length >= 12, "a full motif library");
  for (const motif of MOTIF_NAMES) {
    const svg = illustrate({ motif });
    assert.match(svg, /^<svg /, `${motif}: starts with <svg`);
    assert.match(svg, /<\/svg>\s*$/, `${motif}: closes </svg>`);
    assert.match(svg, /fill="none"/, `${motif}: root fill="none"`);
    assert.ok(svg.includes("<path"), `${motif}: has at least one path`);
    assert.ok(!/stroke/.test(svg), `${motif}: no strokes anywhere`);
    for (const f of fillsOf(svg)) {
      if (f === "none") continue;
      assert.ok(PALETTE.has(f), `${motif}: fill ${f} is in the palette`);
    }
  }
});

test("size sets the SVG width/height while the viewBox stays 1000", () => {
  const svg = illustrate({ motif: "spark", size: 512 });
  assert.match(svg, /width="512"/);
  assert.match(svg, /height="512"/);
  assert.match(svg, /viewBox="0 0 1000 1000"/);
});

test("the wobble is deterministic per seed", () => {
  assert.equal(
    illustrate({ motif: "leaf", seed: 1 }),
    illustrate({ motif: "leaf", seed: 1 }),
    "same seed -> identical output",
  );
  assert.notEqual(
    illustrate({ motif: "leaf", seed: 1 }),
    illustrate({ motif: "leaf", seed: 2 }),
    "different seed -> different wobble",
  );
});

test("accent toggles the clay ink on a motif that uses it", () => {
  assert.ok(illustrate({ motif: "cube", accent: true }).includes(CLAY), "clay on");
  assert.ok(!illustrate({ motif: "cube", accent: false }).includes(CLAY), "clay off");
});

test("accentColor recolours a motif's accent", () => {
  const blue = illustrate({ motif: "gear", accentColor: "blue" });
  assert.ok(blue.includes(BLUE), "the gear center takes the blue accent");
  assert.ok(!blue.includes(CLAY), "and no longer paints clay");
  const raw = illustrate({ motif: "gear", accentColor: "#123456" });
  assert.ok(raw.includes("#123456"), "a raw #rrggbb accent is honored");
});

test("the engineering motifs are present and honor the accent toggle", () => {
  for (const motif of ["node", "grid", "link", "fanout", "chip", "beam", "burst", "mesh"]) {
    assert.ok(MOTIF_NAMES.includes(motif), `${motif} is registered`);
    assert.ok(illustrate({ motif, accent: true }).includes(CLAY), `${motif}: accent on paints clay`);
    assert.ok(!illustrate({ motif, accent: false }).includes(CLAY), `${motif}: accent off drops clay`);
  }
});

test("the data motifs are present and honor the accent toggle", () => {
  for (const motif of ["barchart", "linechart", "piechart", "gauge", "histogram", "funnel", "meter", "trend", "scatterplot", "candles"]) {
    assert.ok(MOTIF_NAMES.includes(motif), `${motif} is registered`);
    assert.ok(illustrate({ motif, accent: true }).includes(CLAY), `${motif}: accent on paints clay`);
    assert.ok(!illustrate({ motif, accent: false }).includes(CLAY), `${motif}: accent off drops clay`);
  }
});

test("the multicolor motifs paint several accents at once", () => {
  for (const motif of ["head", "prism", "atom"]) {
    const svg = illustrate({ motif });
    const used = Object.values(ACCENTS).filter((hex) => svg.includes(hex));
    assert.ok(used.length >= 3, `${motif} uses at least three accent colors`);
  }
});

test("background controls only the backdrop rect", () => {
  // spark itself paints no paper, so paper only appears as the background.
  const none = illustrate({ motif: "spark", background: "none" });
  const paper = illustrate({ motif: "spark", background: "paper" });
  const ink = illustrate({ motif: "spark", background: "ink" });
  assert.ok(!none.includes(PAPER), "no backdrop -> no paper fill");
  assert.ok(paper.includes(PAPER), "paper backdrop present");
  // The ink backdrop is a full-canvas rect using the H/V rectangle path.
  assert.match(ink, /d="M0 0 H1000 V1000/, "ink backdrop is a full-canvas rect");
});

test("invert swaps ink and paper", () => {
  const normal = illustrate({ motif: "spark", background: "none" });
  const inverted = illustrate({ motif: "spark", background: "none", invert: true });
  assert.ok(normal.includes(INK) && !normal.includes(PAPER), "normal draws ink");
  assert.ok(inverted.includes(PAPER), "inverted draws paper ink");
});

test("invert also flips the backdrop so light-on-dark art stays visible", () => {
  // With the default paper background, inverting must flip the backdrop to ink;
  // otherwise the (now cream) shapes would be invisible on a cream page.
  const inv = illustrate({ motif: "spark", invert: true });
  assert.match(inv, /d="M0 0 H1000 V1000 H0 Z" fill="#141413"/, "backdrop flips to ink");
  assert.ok(inv.includes(PAPER), "shapes are painted in paper, visible on the ink backdrop");
  // A transparent backdrop carries no tone, so invert leaves it transparent
  // (no full-canvas backdrop rect is emitted at all).
  const invNone = illustrate({ motif: "spark", background: "none", invert: true });
  assert.ok(!/M0 0 H1000 V1000/.test(invNone), "none stays transparent under invert");
});

test("unknown motif is rejected with a helpful message", () => {
  assert.throws(() => illustrate({ motif: "nope" }), /Unknown motif/);
});

test("style knobs default to a no-op (byte-identical output)", () => {
  const a = illustrate({ motif: "gear", seed: 3 });
  const b = illustrate({ motif: "gear", seed: 3, roughness: 1, weight: 1 });
  assert.equal(a, b, "roughness=1, weight=1 is exactly the default");
});

test("roughness/weight/sketch restyle a motif yet keep it stroke-free, in-palette", () => {
  const base = illustrate({ motif: "leaf", seed: 5 });
  for (const opts of [{ roughness: 3 }, { weight: 2.5 }, { sketch: true }]) {
    const svg = illustrate({ motif: "leaf", seed: 5, ...opts });
    assert.notEqual(svg, base, `${JSON.stringify(opts)} changes the render`);
    assert.ok(!/stroke/.test(svg), `${JSON.stringify(opts)}: no strokes`);
    for (const f of fillsOf(svg)) {
      if (f === "none") continue;
      assert.ok(PALETTE.has(f), `${JSON.stringify(opts)}: fill ${f} in palette`);
    }
  }
});

test("roughness 0 removes the wobble, so the geometry no longer depends on seed", () => {
  assert.equal(
    illustrate({ motif: "gear", seed: 1, roughness: 0 }),
    illustrate({ motif: "gear", seed: 2, roughness: 0 }),
    "a clean render is seed-independent",
  );
});

test("texture primitives emit valid, finite, filled paths (no strokes, no NaN)", () => {
  const rng = () => 0.42; // a deterministic stand-in is enough here
  const shapes = {
    hatch: hatch(200, 200, 400, 400, 45, 40, 6),
    stipple: stipple(500, 500, 200, 200, 24, 10, rng),
    dashed: dashed([[100, 500], [900, 500]], 8, 40, 24),
  };
  for (const [name, d] of Object.entries(shapes)) {
    assert.ok(d.length > 0, `${name}: non-empty`);
    assert.match(d, /^M/, `${name}: starts at a moveto`);
    assert.ok(!/NaN|Infinity/.test(d), `${name}: all coordinates finite`);
    assert.ok(!/stroke/.test(d), `${name}: no strokes`);
  }
});

test("hatch lays down several parallel lines; stipple emits one disc per dot", () => {
  const lines = (hatch(100, 100, 600, 600, 0, 60, 5).match(/M/g) ?? []).length;
  assert.ok(lines >= 5, `hatch drew ${lines} lines across the rect`);
  const dots = (stipple(500, 500, 150, 150, 16, 8, () => 0.5).match(/M/g) ?? []).length;
  assert.equal(dots, 16, "one moveto per stippled dot");
});

test("compose lays out a grid of motifs into one stroke-free, in-palette plate", () => {
  const svg = compose({ motifs: ["gear", "spark", "atom", "heart"], layout: "grid" });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 1000 1000"/);
  assert.equal((svg.match(/<g transform=/g) ?? []).length, 4, "one group per motif");
  assert.ok(!/stroke/.test(svg), "no strokes");
  for (const f of fillsOf(svg)) {
    if (f === "none") continue;
    assert.ok(PALETTE.has(f), `fill ${f} in palette`);
  }
});

test("compose is deterministic and honors size", () => {
  const a = compose({ motifs: ["gear", "spark"], layout: "row", size: 800, seed: 4 });
  const b = compose({ motifs: ["gear", "spark"], layout: "row", size: 800, seed: 4 });
  assert.equal(a, b, "same options -> identical output");
  assert.match(a, /width="800" height="800"/);
});

test("compose scatter varies with seed but stays valid", () => {
  const s1 = compose({ motifs: ["gear", "spark", "atom"], layout: "scatter", seed: 1 });
  const s2 = compose({ motifs: ["gear", "spark", "atom"], layout: "scatter", seed: 2 });
  assert.notEqual(s1, s2, "scatter uses the seed");
  assert.ok(!/stroke/.test(s1) && !/NaN/.test(s1), "clean output");
});

test("compose focal centers a hero above smaller, distinct satellites", () => {
  const svg = compose({ motifs: ["brain", "neuron", "spark"], layout: "focal", seed: 5 });
  assert.match(svg, /viewBox="0 0 1000 1000"/);
  assert.ok(!/stroke/.test(svg) && !/NaN|Infinity/.test(svg), "clean, stroke-free output");
  const scales = [...svg.matchAll(/scale\(([\d.]+)\)/g)].map((m) => parseFloat(m[1]));
  assert.equal(scales.length, 3, "one placed group per motif");
  const hero = Math.max(...scales);
  assert.ok(
    scales.filter((s) => s !== hero).every((s) => s < hero),
    "the hero is drawn larger than every satellite",
  );
  // focal is a distinct arrangement (hierarchy + connector spokes), not the grid
  const grid = compose({ motifs: ["brain", "neuron", "spark"], layout: "grid", seed: 5 });
  assert.notEqual(svg, grid);
});

test("compose focal is deterministic per seed", () => {
  const a = compose({ motifs: ["chip", "gear", "circuit"], layout: "focal", seed: 9 });
  const b = compose({ motifs: ["chip", "gear", "circuit"], layout: "focal", seed: 9 });
  assert.equal(a, b, "same seed, same plate");
});

test("compose honors explicit placements with position and rotation", () => {
  const svg = compose({
    placements: [
      { motif: "spark", x: 300, y: 300, scale: 0.4 },
      { motif: "heart", x: 700, y: 700, scale: 0.4, rotate: 15 },
    ],
  });
  assert.ok(svg.includes("translate(300 300)"), "first placement positioned");
  assert.ok(svg.includes("rotate(15)"), "rotation applied");
  assert.equal((svg.match(/<g transform=/g) ?? []).length, 2);
});

test("compose rejects an empty request and an unknown motif", () => {
  assert.throws(() => compose({}), /provide `placements` or `motifs`/);
  assert.throws(() => compose({ motifs: ["nope"] }), /unknown motif/);
});

test("rasterize renders an SVG to a PNG of the requested width", async () => {
  const svg = illustrate({ motif: "gear", size: 400 });
  const png = await rasterize(svg, 256);
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 256, "width honored");
});
