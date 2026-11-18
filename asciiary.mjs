#!/usr/bin/env node
// asciiary — offline ASCII-art CLI (no AI, no network, no API key).
//
// Drives the Asciiary drawing engines directly so you can make art (and optionally
// publish it to the gallery) with nothing but Node — handy when API credits run
// out or you just want a fully local tool. It wraps the tree_diagram and
// banner_text engines (both dependency-free) plus the illustrate vector-art
// engine; more engines can follow the same shape.
//
// The MCP server is untouched: this file imports the same compiled engines from
// ./dist and re-implements the tiny gallery-write helper locally, so nothing
// here depends on the server process running. The illustrate engine pulls in
// sharp, so it is loaded lazily (only when `asciiary illustrate` runs) — that
// keeps `tree` and `banner` working even where sharp is absent.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { treeDiagram } from "./dist/tree.js";
import { bannerText } from "./dist/banner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where a --save lands with no backend. Mirrors the MCP server's GALLERY_DIR:
// the wall now lives in the database, so this is a gitignored, out-of-repo
// scratch folder, never a path inside the tracked source tree. Env or --out
// overrides it.
const DEFAULT_GALLERY_DIR =
  process.env.ASCII_GALLERY_DIR ?? path.resolve(__dirname, ".local-gallery");

// Where `illustrate` writes its SVG (and optional PNG preview). Mirrors the MCP
// server's OUT_DIR so both tools drop art in the same mcp/out. Env or --out
// overrides it. This is standalone vector output, never the ASCII gallery.
const DEFAULT_ART_DIR =
  process.env.GLYPH_ART_DIR ?? path.resolve(__dirname, "out");

// A user-facing error: printed as a clean message, not a stack trace.
class CliError extends Error {}

// --- argument parsing -----------------------------------------------------
// Flags that consume the next token as a value; everything else is a boolean
// switch or a positional (the outline text).
const VALUE_FLAGS = new Set([
  "--layout",
  "--style",
  "--gap",
  "--fill",
  "--title",
  "--file",
  "--save",
  "--author",
  "--out",
  // illustrate + scene
  "--size",
  "--accent",
  "--background",
  "--seed",
  "--name",
  "--roughness",
  "--weight",
  "--pad",
]);
const BOOL_FLAGS = new Set([
  "--boxed",
  "--force",
  // illustrate + scene
  "--invert",
  "--png",
  "--no-accent",
  "--sketch",
]);

function parseArgs(args) {
  const opts = {};
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      let key = arg;
      let val;
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        key = arg.slice(0, eq);
        val = arg.slice(eq + 1);
      }
      const name = key.slice(2);
      if (BOOL_FLAGS.has(key)) {
        opts[name] = true;
        continue;
      }
      if (VALUE_FLAGS.has(key)) {
        if (val === undefined) {
          val = args[++i];
          if (val === undefined) throw new CliError(`Missing value for ${key}.`);
        }
        opts[name] = val;
        continue;
      }
      throw new CliError(`Unknown option ${key}. Try: asciiary help`);
    } else {
      positionals.push(arg); // "-" (stdin) or outline text
    }
  }
  return { opts, positionals };
}

// --- gallery write (mirrors mcp/src/server.ts, kept local on purpose) -----
function slugify(title) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Read-modify-write the slug -> author manifest so the site can attribute the
// piece honestly (a human, in the CLI's case) instead of the model default.
async function recordAuthor(dir, slug, author) {
  const file = path.join(dir, "authors.json");
  let map = {};
  try {
    map = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    // No manifest yet — start a fresh one.
  }
  map[slug] = author;
  await fs.writeFile(file, JSON.stringify(map, null, 2) + "\n", "utf-8");
}

async function saveToGallery(dir, title, author, art, force) {
  const slug = slugify(title);
  const target = path.join(dir, `${slug}.txt`);
  await fs.mkdir(dir, { recursive: true });
  if (!force && (await fileExists(target))) {
    throw new CliError(
      `Refusing to overwrite an existing piece (${slug}.txt). Use --force to replace it.`,
    );
  }
  await fs.writeFile(target, art + "\n", "utf-8");
  await recordAuthor(dir, slug, author);
  return { slug, target };
}

// Who to credit. Defaults to the human running the CLI — never a model. A model
// name only appears if the user explicitly asks for it via --author/env.
function defaultAuthor() {
  if (process.env.GLYPH_AGENT_AUTHOR) return process.env.GLYPH_AGENT_AUTHOR;
  try {
    return os.userInfo().username || "anonymous";
  } catch {
    return "anonymous";
  }
}

// --- input ----------------------------------------------------------------
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

async function resolveOutline(opts, positionals) {
  if (opts.file) return fs.readFile(path.resolve(opts.file), "utf-8");
  if (positionals.length && !positionals.includes("-")) {
    return positionals.join("\n");
  }
  if (positionals.includes("-") || !process.stdin.isTTY) return readStdin();
  throw new CliError(
    "No outline given. Pass it as an argument, via --file PATH, or piped on stdin.",
  );
}

// Print the art to stdout and, if --save was given, write it to the gallery.
// Shared by every drawing subcommand so save behaves identically everywhere.
async function outputArt(opts, art) {
  if (opts.save !== undefined) {
    const dir = opts.out ? path.resolve(opts.out) : DEFAULT_GALLERY_DIR;
    const author = opts.author || defaultAuthor();
    const { slug, target } = await saveToGallery(
      dir,
      opts.save,
      author,
      art,
      Boolean(opts.force),
    );
    process.stderr.write(
      `Saved "${opts.save}" as ${slug}.txt (author: ${author})\n  ${target}\n`,
    );
  }
  process.stdout.write(art + "\n");
}

// --- commands -------------------------------------------------------------
async function runTree(args) {
  const { opts, positionals } = parseArgs(args);

  const layout = opts.layout ?? "down";
  if (!["down", "list"].includes(layout)) {
    throw new CliError(`--layout must be "down" or "list" (got "${layout}").`);
  }
  const style = opts.style ?? "unicode";
  if (!["unicode", "ascii"].includes(style)) {
    throw new CliError(`--style must be "unicode" or "ascii" (got "${style}").`);
  }
  let gapX;
  if (opts.gap !== undefined) {
    gapX = Number.parseInt(opts.gap, 10);
    if (Number.isNaN(gapX)) throw new CliError(`--gap must be a number (got "${opts.gap}").`);
  }

  const outline = await resolveOutline(opts, positionals);
  if (!outline || !outline.trim()) throw new CliError("The outline is empty.");

  const lines = treeDiagram(outline, {
    layout,
    style,
    boxed: Boolean(opts.boxed),
    gapX,
    title: opts.title,
  });
  const art = lines.join("\n");
  if (!art.trim()) throw new CliError("Nothing to render from that outline.");

  await outputArt(opts, art);
}

async function runBanner(args) {
  const { opts, positionals } = parseArgs(args);

  const style = opts.style ?? "unicode";
  if (!["unicode", "ascii"].includes(style)) {
    throw new CliError(`--style must be "unicode" or "ascii" (got "${style}").`);
  }
  let gap;
  if (opts.gap !== undefined) {
    gap = Number.parseInt(opts.gap, 10);
    if (Number.isNaN(gap)) throw new CliError(`--gap must be a number (got "${opts.gap}").`);
  }

  const text = await resolveOutline(opts, positionals);
  if (!text || !text.trim()) throw new CliError("The text is empty.");

  const lines = bannerText(text, { style, fill: opts.fill, gap });
  const art = lines.join("\n");
  if (!art.trim()) throw new CliError("Nothing to render from that text.");

  await outputArt(opts, art);
}

// The roughness/weight/sketch line-style knobs shared by the vector engines.
// roughness scales the hand-drawn wobble (0 clean .. 4 loose); weight scales the
// ink line thickness; sketch is a looser preset. Omit all three for the default.
function parseStyleOpts(opts) {
  let roughness;
  if (opts.roughness !== undefined) {
    roughness = Number.parseFloat(opts.roughness);
    if (Number.isNaN(roughness) || roughness < 0 || roughness > 4) {
      throw new CliError(`--roughness must be between 0 and 4 (got "${opts.roughness}").`);
    }
  }
  let weight;
  if (opts.weight !== undefined) {
    weight = Number.parseFloat(opts.weight);
    if (Number.isNaN(weight) || weight < 0.2 || weight > 4) {
      throw new CliError(`--weight must be between 0.2 and 4 (got "${opts.weight}").`);
    }
  }
  return { roughness, weight, sketch: Boolean(opts.sketch) };
}

// Scene knobs shared by `illustrate` and `scene`: canvas size, seed, backdrop,
// accent, invert, and the line style above. Returns a plain options bag ready to
// spread into illustrate()/compose() (undefined fields fall back to engine defaults).
function parseVectorCommon(opts) {
  const background = opts.background ?? "paper";
  if (!["paper", "none", "ink"].includes(background)) {
    throw new CliError(`--background must be paper, none, or ink (got "${background}").`);
  }

  let size = 1000;
  if (opts.size !== undefined) {
    size = Number.parseInt(opts.size, 10);
    if (Number.isNaN(size) || size < 64 || size > 4000) {
      throw new CliError(`--size must be a number 64..4000 (got "${opts.size}").`);
    }
  }

  let seed = 7;
  if (opts.seed !== undefined) {
    seed = Number.parseInt(opts.seed, 10);
    if (Number.isNaN(seed)) throw new CliError(`--seed must be a number (got "${opts.seed}").`);
  }

  // --accent NAME sets the accent hue (and keeps the accent on); --no-accent
  // drops the accent shapes entirely. Omit both for the default clay accent.
  const accent = !opts["no-accent"];
  const accentColor = opts.accent; // hue name or #rrggbb; undefined -> clay
  const invert = Boolean(opts.invert);

  return { background, size, seed, accent, accentColor, invert, ...parseStyleOpts(opts) };
}

// Write an SVG (and, with --png, a rasterized preview) to the art dir, then echo
// the SVG to stdout when piped. Shared write contract for `illustrate` + `scene`.
async function writeVectorArt(opts, svg, size, fallbackName) {
  const { rasterize } = await import("./dist/illustrate.js");

  const base = slugify(opts.name ?? fallbackName);
  const dir = opts.out ? path.resolve(opts.out) : DEFAULT_ART_DIR;
  await fs.mkdir(dir, { recursive: true });

  const svgPath = path.join(dir, `${base}.svg`);
  await fs.writeFile(svgPath, svg, "utf-8");
  const written = [svgPath];

  if (opts.png) {
    const png = await rasterize(svg, Math.min(size, 1024));
    const pngPath = path.join(dir, `${base}.png`);
    await fs.writeFile(pngPath, png);
    written.push(pngPath);
  }

  process.stderr.write(
    `Wrote ${written.map((p) => path.relative(process.cwd(), p)).join(" and ")}\n`,
  );
  // Echo the SVG to stdout only when it's piped/redirected, so
  // `asciiary illustrate spark > spark.svg` captures clean SVG while an interactive
  // run stays quiet — the art is the written file, not terminal spam.
  if (!process.stdout.isTTY) process.stdout.write(svg + "\n");
}

// illustrate — real two-tone VECTOR art (SVG) in the Claude-blog style. Unlike
// tree/banner this emits an SVG file (and optionally a PNG), not ASCII, so it
// writes to mcp/out and never touches the gallery. The engine is imported lazily
// here so tree/banner stay free of the sharp dependency.
async function runIllustrate(args) {
  const { opts, positionals } = parseArgs(args);
  const { illustrate, MOTIF_NAMES } = await import("./dist/illustrate.js");

  const motif = positionals.find((p) => p !== "-");
  if (!motif) {
    throw new CliError(`Give a motif name.\nMotifs: ${MOTIF_NAMES.join(", ")}`);
  }
  if (!MOTIF_NAMES.includes(motif)) {
    throw new CliError(
      `Unknown motif "${motif}". Choose one of:\n  ${MOTIF_NAMES.join(", ")}`,
    );
  }

  const common = parseVectorCommon(opts);
  const svg = illustrate({ motif, ...common });

  await writeVectorArt(opts, svg, common.size, motif);
}

// scene — compose SEVERAL motifs into one blog-style vector PLATE (SVG). Like
// illustrate but multi-motif: positionals are the motifs, --layout arranges them.
// Standalone output (mcp/out), never the ASCII gallery. For exact per-motif
// placement (position/scale/rotate), use the illustrate_scene MCP tool.
async function runScene(args) {
  const { opts, positionals } = parseArgs(args);
  const { compose, MOTIF_NAMES } = await import("./dist/illustrate.js");

  const motifs = positionals.filter((p) => p !== "-");
  if (!motifs.length) {
    throw new CliError(
      `Give one or more motif names to arrange.\nMotifs: ${MOTIF_NAMES.join(", ")}`,
    );
  }
  const unknown = motifs.find((m) => !MOTIF_NAMES.includes(m));
  if (unknown) {
    throw new CliError(
      `Unknown motif "${unknown}". Choose from:\n  ${MOTIF_NAMES.join(", ")}`,
    );
  }

  const layout = opts.layout ?? "grid";
  if (!["grid", "row", "column", "scatter"].includes(layout)) {
    throw new CliError(
      `--layout must be grid, row, column, or scatter (got "${layout}").`,
    );
  }

  let pad;
  if (opts.pad !== undefined) {
    pad = Number.parseFloat(opts.pad);
    if (Number.isNaN(pad) || pad < 0 || pad > 0.9) {
      throw new CliError(`--pad must be between 0 and 0.9 (got "${opts.pad}").`);
    }
  }

  const common = parseVectorCommon(opts);
  const svg = compose({ motifs, layout, pad, ...common });

  await writeVectorArt(opts, svg, common.size, "scene");
}

// sketch — natural-language front-end for illustrate/scene. A short phrase is
// mapped DETERMINISTICALLY (plain keyword + synonym matching, no model, offline)
// to a motif or motifs plus accent/style/layout/backdrop, then rendered to an
// SVG in mcp/out. The phrase drives the look; only size/seed/name/out are flags.
async function runSketch(args) {
  const { opts, positionals } = parseArgs(args);
  const { illustrateFromPrompt } = await import("./dist/describe.js");

  let phrase = positionals.filter((p) => p !== "-").join(" ").trim();
  if (!phrase && (positionals.includes("-") || !process.stdin.isTTY)) {
    phrase = (await readStdin()).trim();
  }
  if (!phrase) {
    throw new CliError(
      'Give a phrase, e.g. asciiary sketch "a rough brain and a blue spark on dark".',
    );
  }

  let size = 1000;
  if (opts.size !== undefined) {
    size = Number.parseInt(opts.size, 10);
    if (Number.isNaN(size) || size < 64 || size > 4000) {
      throw new CliError(`--size must be a number 64..4000 (got "${opts.size}").`);
    }
  }
  let seed;
  if (opts.seed !== undefined) {
    seed = Number.parseInt(opts.seed, 10);
    if (Number.isNaN(seed)) throw new CliError(`--seed must be a number (got "${opts.seed}").`);
  }

  let svg;
  let it;
  try {
    ({ svg, interpretation: it } = illustrateFromPrompt(phrase, { size, seed }));
  } catch (err) {
    // Surface the engine's "could not find a motif" as a clean CLI message.
    throw new CliError(err instanceof Error ? err.message : String(err));
  }

  const ignored = it.unknown.length ? ` (ignored: ${it.unknown.join(", ")})` : "";
  process.stderr.write(`Read: ${it.summary}${ignored}\n`);

  const fallback = it.kind === "single" ? it.motif : it.motifs.join("-");
  await writeVectorArt(opts, svg, size, fallback ?? "sketch");
}

function printHelp() {
  process.stdout.write(
    `asciiary — offline ASCII art (no AI, no network)

Usage:
  asciiary tree       "<indented outline>" [options]
  asciiary banner     "TEXT"               [options]
  asciiary illustrate <motif>              [options]
  asciiary scene      <motif> <motif> ...  [options]
  asciiary sketch     "<phrase>"           [options]
  asciiary help

  The text/outline can be a positional argument, --file PATH, or piped stdin (-).

tree — render a hierarchy (indentation defines nesting; tabs work too):
    Root
      Child A
        Leaf
      Child B
  --layout down|list    node-link tree (default) or file-tree list
  --style  unicode|ascii  box-drawing charset (default unicode)
  --boxed               draw a box around each node (down layout)
  --gap N               columns between sibling subtrees (down, default 3)
  --title TEXT          centered heading above the tree

banner — render a phrase as big block letters (use \\n to stack rows):
  --style  unicode|ascii  ink charset: solid block (default) or #
  --fill CHAR           explicit ink character (overrides --style)
  --gap N               blank columns between letters (default 1)

illustrate — real two-tone VECTOR art (SVG) in the Claude-blog style. Writes an
  SVG (and, with --png, a preview) to mcp/out — it is not ASCII, so it does not
  go to the gallery. Run "asciiary illustrate" with no motif to list them.
  <motif>               a builtin motif (spark, gear, brain, atom, prism, ...)
  --size N              pixel size, 64..4000 (default 1000)
  --accent NAME         accent hue: clay, rust, red, blue, pink, yellow, green,
                        slate, or a #rrggbb value (default clay)
  --no-accent           drop the accent shapes entirely
  --background X        paper (cream), none (transparent), or ink (default paper)
  --seed N              reshuffle the hand-drawn wobble (default 7)
  --invert              light-on-dark art
  --roughness N         wobble scale: 0 clean, 1 default, up to 4 loose
  --weight N            ink line-thickness scale, 0.2..4 (default 1)
  --sketch              looser, sketchier hand (a preset)
  --png                 also write a PNG preview beside the SVG
  --name NAME           base filename (default: the motif name)
  --out DIR             output directory (default: mcp/out, or $GLYPH_ART_DIR)

scene — compose SEVERAL motifs into one blog-style vector PLATE (SVG). Like
  illustrate but multi-motif; also writes to mcp/out, not the gallery.
  <motif> <motif> ...   two or more builtin motifs to arrange
  --layout X            grid (default), row, column, or scatter
  --pad N               margin kept around each auto-laid cell, 0..0.9 (default 0.14)
  Plus every illustrate knob above: --size, --accent, --no-accent,
  --background, --seed, --invert, --roughness, --weight, --sketch, --png,
  --name, --out. (For exact per-motif placement, use the MCP tool.)

sketch — describe what you want in plain words; a deterministic keyword parser
  (no AI, no network) maps the phrase to a motif (or several) plus accent, line
  style, layout, and backdrop, then draws it to mcp/out. The phrase drives the
  look; it prints a readback of what it understood.
    asciiary sketch "a rough brain and a blue spark on dark"
    asciiary sketch "gear, spark and atom in a grid" --png
  Cues: two+ motifs compose a plate; grid/row/column/scatter (or "next to",
  "stacked", "scattered") set layout; a colour word or #rrggbb sets the accent;
  rough/clean/bold/thin/sketchy restyle the line; "on dark"/"transparent"/"no
  accent" change the backdrop. Flags: --size, --seed, --name, --png, --out.

Save to the gallery (optional, tree/banner only):
  --save "Title"        write the art to the gallery as <slug>.txt
  --author "Name"       who to credit (default: your username; never a model)
  --out DIR             gallery dir (default: mcp/.local-gallery, or $ASCII_GALLERY_DIR)
  --force               overwrite an existing piece with the same slug

Everything runs locally from the compiled engines in ./dist — no API key needed.
`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    return;
  }
  if (cmd === "tree") {
    await runTree(argv.slice(1));
    return;
  }
  if (cmd === "banner") {
    await runBanner(argv.slice(1));
    return;
  }
  if (cmd === "illustrate") {
    await runIllustrate(argv.slice(1));
    return;
  }
  if (cmd === "scene") {
    await runScene(argv.slice(1));
    return;
  }
  if (cmd === "sketch") {
    await runSketch(argv.slice(1));
    return;
  }
  throw new CliError(`Unknown command "${cmd}". Try: asciiary help`);
}

main().catch((err) => {
  if (err instanceof CliError) {
    process.stderr.write(`asciiary: ${err.message}\n`);
  } else {
    process.stderr.write(`asciiary: ${err?.stack || err}\n`);
  }
  process.exitCode = 1;
});
