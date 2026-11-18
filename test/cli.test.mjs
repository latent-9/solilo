// Smoke tests for the offline `asciiary` CLI (mcp/asciiary.mjs). These spawn the CLI
// as a child process so they exercise the real argv -> render -> save path,
// proving it runs with no AI/network and writes safely into a throwaway dir
// (never the real gallery).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = fileURLToPath(new URL("../asciiary.mjs", import.meta.url));

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf-8",
    ...opts,
  });
}

test("tree renders a node-link diagram to stdout", () => {
  const r = run(["tree", "Root\n  A\n  B"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Root/);
  assert.match(r.stdout, /A/);
  assert.match(r.stdout, /B/);
  assert.ok(/[│─┬┴┼]/.test(r.stdout), "has box-drawing connectors");
});

test("ascii style stays within 7-bit characters", () => {
  const r = run(["tree", "Root\n  A\n  B", "--style", "ascii"]);
  assert.equal(r.status, 0, r.stderr);
  for (const ch of r.stdout) {
    assert.ok(ch.charCodeAt(0) < 128, `non-ascii char: ${JSON.stringify(ch)}`);
  }
});

test("--save writes a .txt and records the author in a temp gallery", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "asciiary-cli-"));
  try {
    const r = run([
      "tree",
      "R\n  A",
      "--save",
      "Demo Piece",
      "--out",
      dir,
      "--author",
      "Tester",
    ]);
    assert.equal(r.status, 0, r.stderr);

    const txt = await fs.readFile(path.join(dir, "demo-piece.txt"), "utf-8");
    assert.match(txt, /R/);
    assert.ok(txt.endsWith("\n"), "art file ends with a trailing newline");

    const authors = JSON.parse(
      await fs.readFile(path.join(dir, "authors.json"), "utf-8"),
    );
    assert.equal(authors["demo-piece"], "Tester");

    // Re-saving the same title without --force must be refused (no clobber).
    const r2 = run(["tree", "R\n  A", "--save", "Demo Piece", "--out", dir]);
    assert.notEqual(r2.status, 0, "should refuse to overwrite");
    assert.match(r2.stderr, /force/i);

    // With --force it overwrites cleanly.
    const r3 = run([
      "tree",
      "R\n  A",
      "--save",
      "Demo Piece",
      "--out",
      dir,
      "--force",
    ]);
    assert.equal(r3.status, 0, r3.stderr);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("an empty outline exits non-zero with a clear message", () => {
  const r = run(["tree", "   "]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /empty/i);
});

test("banner renders big block letters to stdout", () => {
  const r = run(["banner", "HI"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes("█"), "unicode ink block present");
  assert.equal(r.stdout.replace(/\n$/, "").split("\n").length, 5, "font height is 5");
});
