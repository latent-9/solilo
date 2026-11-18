// Tests for the tree_diagram engine (a hierarchy rendered as ASCII).
import { test } from "node:test";
import assert from "node:assert/strict";
import { treeDiagram, parseIndented } from "../dist/tree.js";

test("empty input yields no lines", () => {
  assert.deepEqual(treeDiagram(""), []);
  assert.deepEqual(treeDiagram("   \n\n"), []);
});

test("indentation defines nesting", () => {
  const roots = parseIndented("A\n  B\n    C\n  D");
  assert.equal(roots.length, 1);
  assert.equal(roots[0].label, "A");
  assert.deepEqual(
    roots[0].children.map((n) => n.label),
    ["B", "D"],
  );
  assert.deepEqual(
    roots[0].children[0].children.map((n) => n.label),
    ["C"],
  );
});

test("list layout uses file-tree branches with the last child closed", () => {
  const out = treeDiagram("root\n  a\n  b", { layout: "list" }).join("\n");
  assert.ok(out.startsWith("root"), "root on the first line, unindented");
  assert.ok(out.includes("├── a"), "a is a tee (has a sibling below)");
  assert.ok(out.includes("└── b"), "b is the last child (closed corner)");
});

test("list layout draws pipes for deeper levels", () => {
  const out = treeDiagram("root\n  a\n    x\n  b", { layout: "list" });
  // While 'a' still has a sibling ('b') below, its child 'x' is drawn under a pipe.
  const xLine = out.find((l) => l.includes("x"));
  assert.ok(xLine.includes("│"), "a continuation pipe precedes a's child");
});

test("down layout centers a parent above its children with connectors", () => {
  const out = treeDiagram("root\n  a\n  b\n  c", { layout: "down" });
  assert.ok(out[0].includes("root"), "root on the top row");
  const bar = out[1];
  assert.ok(/[┬┴┼]/.test(bar), "a junction row joins the children");
  const leaves = out[out.length - 1];
  assert.ok(
    leaves.includes("a") && leaves.includes("b") && leaves.includes("c"),
    "all three leaves share the bottom row",
  );
  // The root sits above the middle child, roughly centered over the span.
  const rootCol = out[0].indexOf("root") + 2;
  const aCol = leaves.indexOf("a");
  const cCol = leaves.indexOf("c");
  assert.ok(rootCol > aCol && rootCol < cCol, "root is between the outer leaves");
});

test("a single child is joined by a straight vertical, not a T", () => {
  const out = treeDiagram("root\n  only", { layout: "down" }).join("\n");
  assert.ok(out.includes("│"), "vertical connector present");
  assert.ok(!/[┬┴┼├┤]/.test(out), "no T-junction for an only child");
});

test("boxed nodes get a border and a centered label", () => {
  const out = treeDiagram("Top\n  Left\n  Right", { layout: "down", boxed: true });
  const body = out.join("\n");
  assert.ok(body.includes("╭") && body.includes("╯"), "rounded box corners");
  assert.ok(body.includes("Left") && body.includes("Right"), "labels rendered");
});

test("ascii style stays within 7-bit characters", () => {
  const out = treeDiagram("A\n  B\n    D\n  C", {
    layout: "down",
    style: "ascii",
  }).join("");
  for (const ch of out)
    assert.ok(ch.charCodeAt(0) < 128, `non-ascii char: ${JSON.stringify(ch)}`);
  const list = treeDiagram("A\n  B\n  C", { layout: "list", style: "ascii" }).join("");
  for (const ch of list)
    assert.ok(ch.charCodeAt(0) < 128, `non-ascii char: ${JSON.stringify(ch)}`);
});

test("a title is centered above the tree", () => {
  const out = treeDiagram("A\n  B", { title: "My Tree", layout: "down" });
  assert.ok(out[0].includes("My Tree"), "title on the first line");
  assert.equal(out[1], "", "blank line under the title");
});

test("multiple roots render as a forest", () => {
  const out = treeDiagram("A\n  a1\nB\n  b1", { layout: "list" }).join("\n");
  assert.ok(out.includes("A") && out.includes("B"), "both roots present");
  // In list form the last root closes with a corner, the first with a tee-less root line.
  assert.ok(out.split("\n")[0] === "A", "first root unindented");
});
