// describe.ts — a tiny DETERMINISTIC natural-language front-end for `illustrate`.
//
// It reads a short phrase ("a rough sketch of a brain and a blue spark on dark")
// and maps the words to a motif (or several), an accent hue, a line style, a
// layout, and a backdrop — then renders them through the existing procedural
// engine. There is NO model here and no network: it is plain keyword + synonym
// matching, so it stays offline, reproducible per phrase, and fully testable. It
// only ever CHOOSES motifs and parameters; it never invents SVG paths, which is
// what keeps the output in the blog's flat, hand-inked style.

import { illustrate, compose, MOTIF_NAMES } from "./illustrate.js";
import type { Background, Layout } from "./illustrate.js";

// --- vocabulary -------------------------------------------------------------

// Every motif answers to its own name, plus a hand-picked set of everyday
// synonyms. Keys are singular where possible; the tokenizer also tries a
// singularized form, so most plurals resolve without their own entry.
const MOTIF_SYNONYMS: Record<string, string> = {};
for (const m of MOTIF_NAMES) MOTIF_SYNONYMS[m] = m;
Object.assign(MOTIF_SYNONYMS, {
  // objects
  cog: "gear", cogwheel: "gear", settings: "gear", mechanism: "gear", machinery: "gear",
  lightning: "bolt", thunderbolt: "bolt", thunder: "bolt", flash: "bolt", zap: "bolt", electric: "bolt",
  mind: "brain", thought: "brain", idea: "brain", think: "brain",
  sparkle: "spark", glow: "spark", shine: "spark", glitter: "spark", magic: "spark", shimmer: "spark",
  love: "heart", favourite: "heart", favorite: "heart",
  search: "magnifier", find: "magnifier", magnify: "magnifier", magnifying: "magnifier", lens: "magnifier", zoom: "magnifier", inspect: "magnifier", loupe: "magnifier",
  speech: "chat", message: "chat", talk: "chat", conversation: "chat", comment: "chat", bubble: "chat",
  unlock: "key", lock: "key", password: "key", secret: "key", auth: "key",
  box: "cube", package: "cube", crate: "cube",
  building: "city", buildings: "city", skyline: "city", town: "city", urban: "city",
  wall: "bricks", brick: "bricks", masonry: "bricks",
  plant: "leaf", nature: "leaf", eco: "leaf", growth: "leaf", leaves: "leaf",
  see: "eye", look: "eye", watch: "eye", eyes: "eye", sight: "eye", gaze: "eye",
  console: "terminal", shell: "terminal", bash: "terminal",
  mic: "microphone", podcast: "microphone", karaoke: "microphone", vocals: "microphone",
  scale: "balance", scales: "balance", weigh: "balance", weight: "balance", justice: "balance", libra: "balance", fairness: "balance", tradeoff: "balance", verdict: "balance",
  critter: "golem", creature: "golem", monster: "golem", mascot: "golem", blocky: "golem", buddy: "golem", clayman: "golem",
  extraterrestrial: "alien", ufo: "alien", martian: "alien", spaceman: "alien", visitor: "alien", et: "alien",
  squid: "octopus", kraken: "octopus", tentacle: "octopus", tentacles: "octopus", cephalopod: "octopus", inky: "octopus",
  // systems
  hub: "node", vertex: "node", dot: "node",
  lattice: "grid", cells: "grid",
  edge: "link", connection: "link", connect: "link", chainlink: "link",
  distribute: "fanout", branching: "fanout", split: "fanout",
  processor: "chip", cpu: "chip", silicon: "chip",
  girder: "beam", ibeam: "beam",
  explosion: "burst", starburst: "burst", firework: "burst",
  network: "mesh", graph: "mesh",
  // dev
  app: "window", screen: "window", ui: "window",
  code: "braces", curly: "braces", syntax: "braces",
  pointer: "cursor", click: "cursor",
  directory: "folder", dir: "folder",
  doc: "document", file: "document", page: "document",
  git: "commit", changeset: "commit",
  insect: "bug", beetle: "bug", defect: "bug", glitch: "bug",
  pile: "stack",
  server: "cloud", hosting: "cloud", sky: "cloud",
  // body
  human: "person", people: "person", user: "person", man: "person", woman: "person", figure: "person", somebody: "person",
  palm: "hand", grab: "hand",
  feet: "foot", step: "foot",
  skeleton: "ribcage", ribs: "ribcage", chest: "ribcage",
  lung: "lungs", breath: "lungs", respiratory: "lungs",
  teeth: "tooth", dental: "tooth",
  bicep: "muscle", strength: "muscle", strong: "muscle", flex: "muscle",
  heartbeat: "pulse", ecg: "pulse", ekg: "pulse", vitals: "pulse",
  kidneys: "kidney",
  // AI
  board: "circuit", electronics: "circuit",
  synapse: "neuron", neural: "neuron",
  deep: "layers",
  db: "database", data: "database", storage: "database", sql: "database",
  bits: "binary", bytes: "binary",
  wave: "signal", frequency: "signal", broadcast: "signal", wifi: "signal", wireless: "signal",
  sonar: "radar", scan: "radar", detect: "radar", sweep: "radar",
  coin: "token", tokenize: "token",
  navigate: "compass", north: "compass", heading: "compass",
  // data (the plain names all resolve on their own; these are everyday aliases.
  // "scatter" is intentionally absent — it is read as the scatter LAYOUT.)
  bar: "barchart", bars: "barchart",
  linegraph: "linechart",
  pie: "piechart",
  dial: "gauge", speedometer: "gauge",
  distribution: "histogram", bin: "histogram",
  progress: "meter", slider: "meter",
  trendline: "trend", uptrend: "trend",
  correlation: "scatterplot",
  candle: "candles", candlestick: "candles", ohlc: "candles",
  // medicine
  capsule: "pill", medication: "pill", drug: "pill",
  injection: "syringe", needle: "syringe", vaccine: "syringe",
  chemistry: "flask", beaker: "flask", lab: "flask", potion: "flask", science: "flask",
  genetics: "dna", gene: "dna", helix: "dna", genome: "dna",
  medical: "cross", health: "cross", clinic: "cross", hospital: "cross", firstaid: "cross",
  doctor: "stethoscope", checkup: "stethoscope",
  biology: "microscope",
  plaster: "bandage", wound: "bandage", bandaid: "bandage", heal: "bandage",
  compound: "molecule", chemical: "molecule", bond: "molecule",
  // robot
  bot: "robot", mech: "robot", automaton: "robot",
  humanoid: "android", cyborg: "android",
  manipulator: "arm", actuator: "arm",
  claw: "gripper", grip: "gripper", pincer: "gripper",
  buggy: "rover", mars: "rover",
  quadcopter: "drone", uav: "drone", copter: "drone",
  aerial: "antenna", transmit: "antenna",
  charge: "battery", energy: "battery",
  detector: "sensor", lidar: "sensor",
  screw: "nut", fastener: "nut",
});

// Layout cues, most specific first — the first phrase found wins. "grid", "row",
// "column", "scatter", and "focal" are read as LAYOUT here (so the `grid` motif
// is only reachable through `illustrate` directly). A multi-motif phrase with no
// cue falls back to `focal`, the hero-and-satellites arrangement that reads best.
const LAYOUT_CUES: Array<[string, Layout]> = [
  ["side by side", "row"], ["in a row", "row"], ["in a line", "row"], ["next to", "row"], ["beside", "row"], ["horizontal", "row"], ["row", "row"],
  ["in a grid", "grid"], ["grid of", "grid"], ["as a grid", "grid"], ["tiled", "grid"], ["grid", "grid"],
  ["in a column", "column"], ["stacked", "column"], ["on top of", "column"], ["one above", "column"], ["vertical", "column"], ["column", "column"],
  ["spread out", "scatter"], ["at random", "scatter"], ["scattered", "scatter"], ["strewn", "scatter"], ["dotted around", "scatter"], ["scatter", "scatter"],
  ["surrounded by", "focal"], ["ringed by", "focal"], ["orbiting", "focal"], ["orbited by", "focal"], ["circled by", "focal"], ["at the center", "focal"], ["in the center", "focal"], ["spotlight", "focal"], ["surrounded", "focal"], ["around", "focal"], ["focal", "focal"],
];

// Colour words -> an accent name the engine already knows.
const COLOR_CUES: Record<string, string> = {
  red: "red", crimson: "red", scarlet: "red",
  blue: "blue", azure: "blue", navy: "blue", cobalt: "blue", teal: "blue", cyan: "blue",
  pink: "pink", magenta: "pink", rose: "pink", fuchsia: "pink",
  yellow: "yellow", gold: "yellow", golden: "yellow", amber: "yellow", mustard: "yellow",
  green: "green", lime: "green", emerald: "green", olive: "green", mint: "green",
  clay: "clay", terracotta: "clay", orange: "clay", coral: "clay", salmon: "clay", tan: "clay",
  rust: "rust", rusty: "rust",
  slate: "slate", grey: "slate", gray: "slate", silver: "slate", muted: "slate",
};

// Line-style cues. Multi-word entries (e.g. "hand drawn") are matched as phrases.
const CLEAN_WORDS = ["clean", "crisp", "geometric", "sharp", "precise", "neat", "technical", "vector", "exact", "tidy"];
const ROUGH_WORDS = ["rough", "loose", "messy", "wobbly", "scribbly", "organic", "raw", "imperfect", "hand drawn"];
const BOLD_WORDS = ["bold", "thick", "heavy", "chunky", "fat", "bolder", "beefy"];
const THIN_WORDS = ["thin", "fine", "delicate", "slim", "wispy", "hairline", "spindly"];
const SKETCH_WORDS = ["sketch", "sketchy", "doodle", "doodly", "draft"];

const INVERT_CUES = ["light on dark", "on dark", "on a dark", "dark background", "dark mode", "on black", "at night", "night sky", "nighttime", "inverted"];
const NONE_CUES = ["transparent", "no background", "no backdrop", "cut out", "cutout"];
const NOACCENT_CUES = ["no accent", "without accent", "without an accent", "monochrome", "two tone", "black and white", "greyscale", "grayscale", "single colour", "single color", "one colour", "one color"];

// Filler words that are neither motifs nor parameters — tracked only so the
// "unrecognized words" note stays clean.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "with", "in", "on", "at", "to", "for", "some", "two", "three", "four", "five",
  "several", "many", "few", "draw", "drawing", "drawn", "picture", "image", "illustration", "icon", "art", "artwork",
  "show", "me", "please", "make", "create", "give", "want", "need", "into", "as", "that", "this", "it", "big", "small",
  "little", "tiny", "huge", "nice", "cool", "simple", "flat", "style", "blog", "cute", "minimal", "modern", "pair",
  "couple", "group", "set", "bunch", "over", "near", "then", "plus", "also", "background", "accent", "colour", "color",
]);

// --- helpers ----------------------------------------------------------------

// Normalize to lowercase, collapse every non-alphanumeric run (except a leading
// '#' for hex colours) to a single space, and pad with spaces so ` word ` and
// ` two word ` phrase checks work at the edges too.
function normalize(prompt: string): string {
  const norm = prompt.toLowerCase().replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim();
  return ` ${norm} `;
}

function tokensOf(padded: string): string[] {
  return padded.trim().split(" ").filter(Boolean);
}

// Drop a plural 's' for words long enough that it is not part of the root.
function singular(t: string): string {
  if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

// A small deterministic string hash (FNV-1a, 32-bit) so a given phrase always
// gets the same wobble seed — same words in, same art out — while different
// phrases vary. No Math.random, so the whole engine stays reproducible.
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h % 1_000_000;
}

// --- interpretation ---------------------------------------------------------

export interface Interpretation {
  kind: "single" | "scene";
  motif?: string; // set when kind === "single"
  motifs: string[]; // the full ordered list (length 1 for a single motif)
  layout?: Layout;
  accent?: boolean;
  accentColor?: string;
  background?: Background;
  invert?: boolean;
  roughness?: number;
  weight?: number;
  sketch?: boolean;
  seed: number;
  summary: string; // a short human-readable readback of what was understood
  unknown: string[]; // content words that matched nothing (ignored)
}

/**
 * Read a short phrase into a render plan (motif/motifs + parameters). Pure and
 * deterministic: no model, no network, same phrase -> same plan.
 */
export function interpret(prompt: string, opts: { seed?: number } = {}): Interpretation {
  const padded = normalize(prompt);
  const has = (phrase: string) => padded.includes(` ${phrase} `);
  // Words consumed by a non-motif category, so they are not also read as motifs.
  const consumed = new Set<string>();
  const consume = (phrase: string) => {
    for (const w of phrase.split(" ")) consumed.add(w);
  };

  // Layout — first cue (most specific listed first) wins.
  let layout: Layout | undefined;
  for (const [phrase, value] of LAYOUT_CUES) {
    if (has(phrase)) {
      layout = value;
      consume(phrase);
      break;
    }
  }

  // Accent colour — an explicit #hex wins over a colour name; among names, the
  // one that appears earliest in the phrase wins.
  let accentColor: string | undefined;
  const hex = padded.match(/#[0-9a-f]{3,8}\b/);
  let bestAt = Infinity;
  for (const name of Object.keys(COLOR_CUES)) {
    const at = padded.indexOf(` ${name} `);
    if (at !== -1) {
      consume(name);
      if (at < bestAt) {
        bestAt = at;
        accentColor = COLOR_CUES[name];
      }
    }
  }
  if (hex) accentColor = hex[0];

  // Line style.
  let roughness: number | undefined;
  let weight: number | undefined;
  let sketch: boolean | undefined;
  const applyList = (words: string[], fn: (w: string) => void) => {
    for (const w of words) if (has(w)) { consume(w); fn(w); }
  };
  applyList(ROUGH_WORDS, () => { roughness = 2.6; });
  applyList(CLEAN_WORDS, () => { roughness = 0; }); // clean is the stronger intent; it wins if both appear
  applyList(SKETCH_WORDS, () => { sketch = true; });
  applyList(BOLD_WORDS, () => { weight = 2; });
  applyList(THIN_WORDS, () => { weight = 0.5; });

  // Backdrop + accent toggle.
  let invert: boolean | undefined;
  for (const p of INVERT_CUES) if (has(p)) { invert = true; consume(p); }
  let background: Background | undefined;
  for (const p of NONE_CUES) if (has(p)) { background = "none"; consume(p); }
  let accent: boolean | undefined;
  for (const p of NOACCENT_CUES) if (has(p)) { accent = false; consume(p); }

  // Motifs — everything left, mapped through the synonym table, in order, deduped.
  const seen = new Set<string>();
  const motifs: string[] = [];
  const unknown: string[] = [];
  for (const raw of tokensOf(padded)) {
    if (consumed.has(raw)) continue;
    const motif = MOTIF_SYNONYMS[raw] ?? MOTIF_SYNONYMS[singular(raw)];
    if (motif) {
      if (!seen.has(motif)) {
        seen.add(motif);
        motifs.push(motif);
      }
    } else if (raw.length >= 3 && !STOPWORDS.has(raw) && !/^[0-9#]/.test(raw)) {
      unknown.push(raw);
    }
  }

  if (motifs.length === 0) {
    throw new Error(
      `Could not find a motif in "${prompt}". Name something to draw — e.g. gear, ` +
        `brain, spark, robot, heart, flask, atom, or any of the ${MOTIF_NAMES.length} motifs.`,
    );
  }

  const capped = motifs.slice(0, 12); // a plate stays legible at up to a dozen
  const kind: "single" | "scene" = capped.length >= 2 ? "scene" : "single";
  if (kind === "scene" && !layout) layout = "focal";
  const seed = opts.seed ?? hashSeed(padded);

  // A short readback so a caller can see how the phrase was understood.
  const bits: string[] = [kind === "single" ? capped[0] : `${capped.join(" + ")} (${layout})`];
  if (accentColor) bits.push(`${accentColor} accent`);
  if (accent === false) bits.push("no accent");
  if (sketch) bits.push("sketch");
  if (roughness === 0) bits.push("clean");
  else if (roughness !== undefined && roughness > 1) bits.push("rough");
  if (weight !== undefined && weight > 1) bits.push("bold");
  else if (weight !== undefined && weight < 1) bits.push("thin");
  if (invert) bits.push("on dark");
  if (background === "none") bits.push("transparent");
  bits.push(`seed ${seed}`);

  return {
    kind,
    motif: kind === "single" ? capped[0] : undefined,
    motifs: capped,
    layout,
    accent,
    accentColor,
    background,
    invert,
    roughness,
    weight,
    sketch,
    seed,
    summary: bits.join(", "),
    unknown,
  };
}

/** Render a plan from `interpret` into an SVG through the procedural engine. */
export function renderInterpretation(it: Interpretation, opts: { size?: number } = {}): string {
  const shared = {
    size: opts.size,
    accent: it.accent,
    accentColor: it.accentColor,
    background: it.background,
    invert: it.invert,
    roughness: it.roughness,
    weight: it.weight,
    sketch: it.sketch,
    seed: it.seed,
  };
  if (it.kind === "scene") {
    return compose({ motifs: it.motifs, layout: it.layout ?? "focal", ...shared });
  }
  return illustrate({ motif: it.motif as string, ...shared });
}

/**
 * One-shot: read a phrase and return both the rendered SVG and the plan that
 * produced it (so the caller can show a readback of what it understood).
 */
export function illustrateFromPrompt(
  prompt: string,
  opts: { size?: number; seed?: number } = {},
): { svg: string; interpretation: Interpretation } {
  const interpretation = interpret(prompt, { seed: opts.seed });
  return { svg: renderInterpretation(interpretation, { size: opts.size }), interpretation };
}
