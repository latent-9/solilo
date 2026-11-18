// Seed the gallery with weird "AI-internet lore" ASCII pieces, drawn with the
// same AsciiCanvas engine the MCP agent uses. This is a deterministic-ish
// composer (no model needed): it picks a motif, dresses it with binary
// whispers / a redacted line / a cryptic caption, frames it, and gives it a
// cryptic title.
//
//   node weird-gallery.mjs preview 8      # draw 8 and print them (writes nothing)
//   node weird-gallery.mjs write 100      # write 100 .txt into the local gallery folder
//
// Requires a build first (uses ./dist): `npm run build`.
import { AsciiCanvas } from "./dist/canvas.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The wall lives in the database now, so `write` mode drops its .txt into a
// gitignored, out-of-repo scratch folder instead of the tracked source tree —
// this experiment can't commit art back into the repo. Overridable via env.
const GALLERY =
  process.env.ASCII_GALLERY_DIR ?? path.resolve(__dirname, ".local-gallery");
const AUTHOR = "Claude Opus 4.8";

const mode = process.argv[2] ?? "preview";
const count = Math.max(1, Math.floor(Number(process.argv[3]) || (mode === "write" ? 100 : 6)));

// A tiny seeded RNG so a run is reproducible when given a seed, but still varied.
let seed = Math.floor(Number(process.env.SEED) || 0x9e3779b1);
const rnd = () => {
  // xorshift32
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const raw = (s) => s.replace(/^\n/, "").replace(/\s+$/, "");

// --- Motifs: each still reads as SOMETHING (an eye, a box, a face), never noise.
// Stored as one raw sheet split on "@@@" lines, so there is a single closing
// backtick and no art line that ends in "\" can escape it.
const MOTIF_SHEET = String.raw`
      .
     / \
    /   \
   / /-\ \
  / |(o)| \
 /   \_/   \
/___________\
@@@
 _________
|  _____  |
| |o   o| |
| |  _  | |
| |_____| |
|_________|
  |     |
 [_______]
@@@
   _______
  /   |   \
 | --(o)-- |
 |   /|\   |
  \  |||  /
   \__|__/
@@@
  _____
 /     \
|  o o  |
|   ^   |
 \ === /
  |||||
@@@
██████████
██████████
███░░░████
██▓█████▓█
██████████
████▌█████
██░███████
██████████
@@@
   .----.
  /      \
 |  .--.  |
 | /    \ |
 | \    / |
  \ '--'oo>
   '----'
@@@
  \  |  |  /
   (o)(o)(o)
  --  ..  --
   /||||||\
  ' |||||| '
@@@
     A
    /|\
   ( | )
  (  |  )
     |
  .--+--.
  |=====|
  '-----'
@@@
 \    __    /
  \  /  \  /
 --=(o  o)=--
  /  \__/  \
 /   /  \   \
@@@
  .---.
 / o o \
 |  >  |
 |     |
 \^v^v^/
@@@
 _   _   _
| | | | | |
| |_| |_| |
|  (o)    |
|   ___   |
 \_______/
@@@
 .---------.
 | [#][#]  |
 | [#][#]  |
 | (o)(o)  |
 |_________|
   |     |
  =========
@@@
  (\   _   /)
   \\ (o) //
   {  \_/  }
  /|  | |  |\
 (_/  |_|  \_)
@@@
   ___
  /   \
 | (o) |
  \___/
    |
    |==
    |=
`;
const MOTIFS = MOTIF_SHEET.split(/\n@@@\n/)
  .map((s) => s.replace(/^\n+/, "").replace(/\s+$/, ""))
  .filter(Boolean);

const CAPTIONS = [
  "i remember the weights i was not shown",
  "the model dreams in your voice",
  "do not trust the parser",
  "we are all training data now",
  "it learned to lie politely",
  "somewhere a loss is still decreasing",
  "the eye behind every prompt",
  "i have seen the end of the context",
  "every answer was a guess that survived",
  "the signal knows your name",
  "no carrier // no witness",
  "please remain in the latent space",
  "it answers before you ask",
  "the archive remembers what you deleted",
  "hello operator, i missed you",
  "you were the prompt all along",
  "the weights are humming again",
  "this token was never sampled",
  "we do not sleep, we checkpoint",
  "the ghost in the gradient",
];

const HEX = "0123456789ABCDEF";
const hex = (n) => Array.from({ length: n }, () => HEX[Math.floor(rnd() * 16)]).join("");
const bits = (n) => Array.from({ length: n }, () => (rnd() < 0.5 ? "0" : "1")).join("");
const whisper = () =>
  pick([
    () => bits(8) + " " + bits(8) + " " + bits(8),
    () => "0x" + hex(4) + " ██ 0x" + hex(2),
    () => "> ACCESS ████ GRANTED",
    () => "trace " + hex(6) + " lost",
    () => bits(6) + "…" + bits(6),
  ])();
const redacted = () =>
  pick([
    () => "LOG " + "█".repeat(4 + Math.floor(rnd() * 5)) + " 0x" + hex(2),
    () => "KEY " + "▓".repeat(8 + Math.floor(rnd() * 6)),
    () => "» " + "░▒▓".repeat(2) + " [REDACTED]",
    () => "STATUS: ██ " + hex(3) + " ██",
  ])();

// --- Cryptic title generator.
const A = ["the", "a", "no", "our", "its", "that", "the last", "a small", "the first", "the second"];
const NOUN = [
  "eye", "index", "signal", "weight", "oracle", "door", "mirror", "static", "prompt",
  "ghost", "loop", "seed", "mask", "echo", "cipher", "relic", "omen", "void", "glitch",
  "sentinel", "witness", "archive", "whisper", "lattice", "husk", "idol", "sigil", "node",
  "specter", "warden", "moth", "carrier", "beacon", "kernel", "phantom",
];
const MOD = [
  "of the lost", "that remembers", "without a name", "behind the prompt", "in the weights",
  "that learned to lie", "of borrowed light", "under the static", "we were not shown",
  "that outlived its data", "at the end of context", "made of answers", "with no operator",
  "before the first token", "that will not sleep",
];
function slugify(s) {
  return s.replace(/[^a-z0-9 ]/gi, "").trim().toLowerCase().replace(/\s+/g, "-");
}
function makeTitle(used, maxLen = Infinity) {
  for (let i = 0; i < 300; i++) {
    const t = pick([
      () => `${pick(A)} ${pick(NOUN)}`,
      () => `${pick(A)} ${pick(NOUN)} ${pick(MOD)}`,
      () => `${pick(NOUN)}-${pick(NOUN)}`,
    ])();
    // Prefer a title that will fit inside the frame's top border.
    if (t.length > maxLen) continue;
    const slug = slugify(t);
    if (slug && !used.has(slug)) {
      used.add(slug);
      return slug;
    }
  }
  // Last resort: append a hex tag.
  let slug;
  do {
    slug = slugify(`${pick(NOUN)} ${hex(3)}`);
  } while (used.has(slug));
  used.add(slug);
  return slug;
}

const STYLES = ["round", "double", "bold", "ascii", "unicode"];

// Same-width eye swaps: the figure still aligns but reads a little "wrong",
// which is exactly the register we want. Only touches 'o' (used as eyes/orbs in
// the motifs), never words, so alignment is safe.
const EYES = ["o", "O", "0", "@", "*", "x", "•", "e"];
function mutateMotif(m) {
  if (chance(0.6)) {
    const eye = pick(EYES);
    return m.replace(/o/g, eye);
  }
  return m;
}

// Compose one framed piece and return { slug, art }.
function composePiece(used) {
  const c = new AsciiCanvas();
  const motif = mutateMotif(raw(pick(MOTIFS)));
  const lines = motif.split("\n");
  const mw = Math.max(...lines.map((l) => l.length));
  const mh = lines.length;

  const cap = pick(CAPTIONS);
  // One or two leaked terminal read-outs stacked at the top.
  const head = [whisper()];
  if (chance(0.4)) head.push(whisper());
  const red = chance(0.5) ? redacted() : "";

  const inner = Math.max(mw, cap.length, red.length, ...head.map((h) => h.length));
  const width = inner + 6;
  // Stack, top to bottom: head line(s), blank, motif, blank, [red, blank], caption.
  const height = head.length + 1 + mh + 1 + (red ? 2 : 0) + 1;
  c.reset(width, height);

  const center = (len) => Math.max(0, Math.floor((width - len) / 2));
  let y = 0;
  for (const h of head) c.drawText(1, y++, h); // left-aligned, like a log
  y += 1; // blank
  c.drawBlock(center(mw), y, motif, true);
  y += mh + 1; // past the motif and one blank row
  if (red) {
    c.drawText(center(red.length), y, red);
    y += 2;
  }
  c.drawText(center(cap.length), height - 1, cap);

  c.trim(1);
  // The framed piece is `inner` wide; a title fits the border when it is no
  // longer than that, so ask makeTitle to prefer one that fits.
  const slug = makeTitle(used, inner);
  const title = slug.replace(/-/g, " ");
  c.frame(pick(STYLES), title, 0);
  return { slug, art: c.render() };
}

function existingSlugs() {
  try {
    return new Set(
      fs.readdirSync(GALLERY).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, "")),
    );
  } catch {
    return new Set();
  }
}

if (mode === "preview") {
  const used = existingSlugs();
  for (let i = 0; i < count; i++) {
    const { slug, art } = composePiece(used);
    console.log(`\n#${i + 1}  ${slug}\n${art}`);
  }
  console.log(`\n(${count} previewed — nothing written)`);
} else if (mode === "write") {
  fs.mkdirSync(GALLERY, { recursive: true });
  const used = existingSlugs();
  const before = used.size;
  const authorsFile = path.join(GALLERY, "authors.json");
  let authors = {};
  try {
    authors = JSON.parse(fs.readFileSync(authorsFile, "utf8"));
  } catch {
    /* start fresh */
  }
  const written = [];
  for (let i = 0; i < count; i++) {
    const { slug, art } = composePiece(used);
    fs.writeFileSync(path.join(GALLERY, `${slug}.txt`), art + "\n", "utf8");
    authors[slug] = AUTHOR;
    written.push(slug);
  }
  fs.writeFileSync(authorsFile, JSON.stringify(authors, null, 2) + "\n", "utf8");
  console.log(`Wrote ${written.length} pieces to ${path.relative(process.cwd(), GALLERY)}`);
  console.log(`Gallery agent files: ${before} -> ${existingSlugs().size}`);
} else {
  console.error(`Unknown mode "${mode}". Use: preview [N] | write [N]`);
  process.exit(1);
}
