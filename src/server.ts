#!/usr/bin/env node
// ascii-canvas MCP server.
// Exposes drawing tools so any MCP client (Claude Desktop, Claude Code, etc.)
// can create ASCII art and publish it to the site's gallery.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AsciiCanvas } from "./canvas.js";
import {
  DENSITY_RAMP,
  RAMPS,
  imageToAsciiLines,
  imageToBrailleLines,
  restyleAscii,
  traceToBrailleLines,
} from "./image.js";
import { BUILTIN_SHAPES, shapeText } from "./calligram.js";
import { ICON_NAMES, iconToBrailleLines } from "./icons.js";
import {
  MOTIF_NAMES,
  ACCENT_NAMES,
  illustrate,
  compose,
  rasterize,
} from "./illustrate.js";
import { illustrateFromPrompt } from "./describe.js";
import { blockDiagram } from "./diagram.js";
import { treeDiagram } from "./tree.js";
import { bannerText } from "./banner.js";
import { resolveAuthor } from "./author.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where a saved piece lands when no backend is configured. The wall now lives in
// the database (see supabase/README.md), so this is only a local, out-of-repo
// fallback — a gitignored scratch folder — never a path inside the tracked repo,
// so agent output can't be committed and copied out of the source tree. Override
// with ASCII_GALLERY_DIR to point it wherever a self-host wants local files.
const GALLERY_DIR =
  process.env.ASCII_GALLERY_DIR ?? path.resolve(__dirname, "../.local-gallery");

// Where the `illustrate` tool writes generated SVG/PNG art. This is standalone
// vector output — it is NOT the ASCII gallery and never publishes to the site.
const OUT_DIR = process.env.GLYPH_ART_DIR ?? path.resolve(__dirname, "../out");

// Optional public backend. When set, drawings publish to the shared gallery
// instead of a local file. See supabase/README.md.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
// The dedicated Supabase account the agent signs in as. Its uid must be listed
// in the `agent_identities` table (see supabase/README.md) — that allow-list is
// what authorises stamping the AI `author` marker. These creds live in the MCP
// host env ONLY; never commit them.
const AGENT_EMAIL = process.env.GLYPH_AGENT_EMAIL;
const AGENT_PASSWORD = process.env.GLYPH_AGENT_PASSWORD;
// Remote publishing needs the backend AND the agent login: the wall rejects
// anonymous inserts now, so without a verified agent identity we save locally.
const remoteEnabled = Boolean(
  SUPABASE_URL && SUPABASE_KEY && AGENT_EMAIL && AGENT_PASSWORD,
);

// Cached agent access token (Supabase JWTs last ~1h). Sign in once with the
// password grant, reuse the token until shortly before it expires, then refresh.
let agentAuth: { token: string; expiresAt: number } | null = null;

async function agentToken(): Promise<string | null> {
  const now = Date.now();
  if (agentAuth && now < agentAuth.expiresAt - 60_000) return agentAuth.token;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY as string,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: AGENT_EMAIL, password: AGENT_PASSWORD }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return null;
    agentAuth = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 3600) * 1000,
    };
    return agentAuth.token;
  } catch {
    return null;
  }
}

async function publishRemote(
  title: string,
  art: string,
  author: string,
): Promise<boolean> {
  const token = await agentToken();
  if (!token) return false;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/arts`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY as string,
      // The agent's own access token -> PostgREST runs as `authenticated` and its
      // uid matches the agent_identities allow-list, which is what permits the
      // honest per-model `author` marker below. A non-agent token cannot set it.
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      title: title.slice(0, 80),
      art: art.slice(0, 8000),
      author: author.slice(0, 40),
    }),
  });
  return res.ok;
}

// One active canvas per server process.
const canvas = new AsciiCanvas();

const server = new McpServer({ name: "solilo", version: "0.1.0" });

// The MCP client that connected (e.g. "claude-ai", "Claude Code", "Cursor"),
// reported in the initialize handshake. Used to attribute agent-drawn pieces to
// the specific brain that drew them. Falls back to "agent" if unavailable.
function clientName(): string {
  try {
    return server.server.getClientVersion()?.name || "agent";
  } catch {
    return "agent";
  }
}

// The name to attribute a piece to. Resolved from the reporting client and an
// optional GLYPH_AGENT_AUTHOR override so a specific model (Sonnet, Haiku, ...)
// is credited honestly rather than everything defaulting to one model. See
// author.ts for the resolution order.
function displayAuthor(): string {
  return resolveAuthor(clientName(), process.env.GLYPH_AGENT_AUTHOR);
}

// Record which brain drew a locally-saved piece, keyed by file slug, so the site
// can attribute it honestly instead of assuming every agent file is Claude's.
async function recordAuthor(slug: string, author: string): Promise<void> {
  const file = path.join(GALLERY_DIR, "authors.json");
  let map: Record<string, string> = {};
  try {
    map = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    // No manifest yet — start a fresh one.
  }
  map[slug] = author;
  await fs.writeFile(file, JSON.stringify(map, null, 2) + "\n", "utf-8");
}

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });

server.tool(
  "new_canvas",
  "Start a fresh ASCII canvas of the given size (in characters). Call this before drawing a new piece.",
  { width: z.number().int().min(1).max(400), height: z.number().int().min(1).max(400) },
  async ({ width, height }) => {
    canvas.reset(width, height);
    return ok(`New ${width}x${height} canvas ready.`);
  },
);

server.tool(
  "set_char",
  "Place a single character at a cell. Coordinates are 0-based; (0,0) is top-left.",
  { x: z.number().int(), y: z.number().int(), char: z.string().min(1).max(1) },
  async ({ x, y, char }) => {
    canvas.setChar(x, y, char);
    return ok(`Set '${char}' at (${x}, ${y}).`);
  },
);

server.tool(
  "draw_text",
  "Write a line of text horizontally starting at (x, y).",
  { x: z.number().int(), y: z.number().int(), text: z.string() },
  async ({ x, y, text }) => {
    canvas.drawText(x, y, text);
    return ok(`Wrote "${text}" at (${x}, ${y}).`);
  },
);

server.tool(
  "draw_block",
  "Place a multi-line block of text or ASCII with its top-left at (x, y). Each newline starts a new row. Use it to drop pre-made art in one call, or to compose shaped/concrete poetry by placing words at chosen positions. Set `transparent` to layer the block over existing art — blank cells (space or braille-blank) are skipped instead of erasing what's underneath.",
  {
    x: z.number().int(),
    y: z.number().int(),
    text: z.string(),
    transparent: z
      .boolean()
      .default(false)
      .describe("Skip blank cells (space / braille-blank) so the block composites over existing art."),
  },
  async ({ x, y, text, transparent }) => {
    canvas.drawBlock(x, y, text, transparent);
    const rows = text.split("\n").length;
    return ok(`Placed a ${rows}-line block at (${x}, ${y}).`);
  },
);

server.tool(
  "image_to_ascii",
  "Convert an image file (png, jpg, webp, ...) into ASCII by brightness and stamp it onto the current canvas at (x, y). Ideal for photo/logo density art. Uses jp2a's fine 23-step tonal ramp by default for smooth gradation. The image is fitted to `max_width` columns (rows are derived from its aspect ratio). Returns the placed size so you can size the canvas first.",
  {
    path: z.string().min(1).describe("Absolute or relative path to the image file."),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    max_width: z
      .number()
      .int()
      .min(4)
      .max(400)
      .default(100)
      .describe("Target width in characters."),
    invert: z
      .boolean()
      .default(false)
      .describe("Flip dark/bright — use for dark subjects on a light background."),
    ramp: z
      .string()
      .min(2)
      .max(64)
      .optional()
      .describe("Custom density ramp from empty to full. Overrides `ramp_preset`."),
    ramp_preset: z
      .enum(["jp2a", "classic", "blocks", "braille"])
      .default("jp2a")
      .describe("Built-in ramp: 'jp2a' = 23-step smooth tone, 'classic' = 10-step graphic, 'blocks' = solid shade blocks (░▒▓█), 'braille' = fine braille tone. Ignored if `ramp` is given."),
    gamma: z
      .number()
      .min(0.1)
      .max(5)
      .default(1)
      .describe("Midtone gamma (extends jp2a's linear mapping). 1 = off; <1 deepens shadows, >1 lifts them."),
    auto_contrast: z
      .boolean()
      .default(true)
      .describe("Stretch the brightness range to use the full ramp (sharper result)."),
    edges: z
      .boolean()
      .default(false)
      .describe("Structure-aware: draw contours as | - / \\ strokes over the fill, for crisper silhouettes."),
    edge_threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.18)
      .describe("Edge sensitivity 0..1 (lower = more contour strokes)."),
    dither: z
      .enum(["none", "bayer", "floyd"])
      .default("none")
      .describe("Fake continuous tone from few ramp steps: 'bayer' = ordered cross-hatch, 'floyd' = Floyd–Steinberg grain. Pairs well with the 'blocks' or 'classic' ramp."),
    transparent: z
      .boolean()
      .default(false)
      .describe("Composite over existing art — skip blank cells so the image layers on top instead of erasing the background."),
  },
  async ({ path: imgPath, x, y, max_width, invert, ramp, ramp_preset, gamma, auto_contrast, edges, edge_threshold, dither, transparent }) => {
    try {
      const lines = await imageToAsciiLines(imgPath, {
        maxWidth: max_width,
        invert,
        ramp: ramp ?? RAMPS[ramp_preset],
        gamma,
        autoContrast: auto_contrast,
        edges,
        edgeThreshold: edge_threshold,
        dither,
      });
      const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
      const rows = lines.length;

      canvas.drawBlock(x, y, lines.join("\n"), transparent);
      return ok(
        `Placed a ${cols}x${rows} ASCII image at (${x}, ${y}). Size the canvas at least ${x + cols}x${y + rows} to fit it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `image_to_ascii failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "image_to_braille",
  "Convert an image file (png, jpg, webp, ...) into high-resolution Unicode braille art and stamp it onto the canvas at (x, y). Each braille cell holds a 2x4 dot grid, so this renders at 2x the horizontal and 4x the vertical resolution of image_to_ascii — the sharpest photo/logo/silhouette rendering here. Dots are 1-bit, so dithering (on by default) fakes tone. The image is fitted to `max_width` braille cells (rows follow the aspect ratio). Returns the placed size so you can size the canvas first.",
  {
    path: z.string().min(1).describe("Absolute or relative path to the image file."),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    max_width: z
      .number()
      .int()
      .min(4)
      .max(400)
      .default(80)
      .describe("Target width in braille cells (each cell is 2 sub-pixels wide)."),
    invert: z
      .boolean()
      .default(false)
      .describe("Flip which pixels light a dot — use for dark subjects on a light background."),
    auto_contrast: z
      .boolean()
      .default(true)
      .describe("Stretch the brightness range for a sharper result."),
    gamma: z
      .number()
      .min(0.1)
      .max(5)
      .default(1)
      .describe("Midtone gamma. 1 = off; <1 deepens shadows, >1 lifts them."),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Dot cutoff 0..1 for dither='none' (crisp line art). Ignored when dithering."),
    dither: z
      .enum(["none", "bayer", "floyd"])
      .default("floyd")
      .describe("1-bit tone: 'floyd' = Floyd–Steinberg grain (default, best for photos), 'bayer' = ordered cross-hatch, 'none' = hard threshold for line art."),
    edges: z
      .boolean()
      .default(false)
      .describe("Outline mode: light dots only along steep brightness gradients, turning the image into a clean braille line drawing (ignores dither/tone)."),
    edge_threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.18)
      .describe("Edge sensitivity 0..1 for `edges` (lower = more contour detail)."),
    transparent: z
      .boolean()
      .default(false)
      .describe("Composite over existing art — skip blank cells (braille-blank / space) so the render layers on top instead of erasing the background."),
  },
  async ({ path: imgPath, x, y, max_width, invert, auto_contrast, gamma, threshold, dither, edges, edge_threshold, transparent }) => {
    try {
      const lines = await imageToBrailleLines(imgPath, {
        maxWidth: max_width,
        invert,
        autoContrast: auto_contrast,
        gamma,
        threshold,
        dither,
        edges,
        edgeThreshold: edge_threshold,
      });
      const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
      const rows = lines.length;

      canvas.drawBlock(x, y, lines.join("\n"), transparent);
      return ok(
        `Placed a ${cols}x${rows} braille image at (${x}, ${y}). Size the canvas at least ${x + cols}x${y + rows} to fit it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `image_to_braille failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "restyle_ascii",
  "Re-skin an existing ASCII drawing with a different character palette. Drop in `text` (or a `path` to a .txt, or use the current canvas) and it swaps every glyph for the matching-darkness character in a target ramp — turning `#%@` art into shade blocks (░▒▓█), braille tone, or any custom ramp, while keeping the picture. Or give an explicit `map` of char->char substitutions for full control. The result replaces the canvas so you can render or save it.",
  {
    text: z
      .string()
      .optional()
      .describe("The ASCII art to restyle. If omitted, uses `path`, else the current canvas."),
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Path to a .txt file to restyle. Used when `text` is omitted."),
    ramp: z
      .string()
      .min(2)
      .max(64)
      .optional()
      .describe("Custom target ramp, empty -> full ink. Overrides `ramp_preset`."),
    ramp_preset: z
      .enum(["classic", "jp2a", "blocks", "braille"])
      .default("blocks")
      .describe("Target palette: 'blocks' = ░▒▓█, 'braille' = fine tone, 'classic'/'jp2a' = density letters. Ignored if `ramp` or `map` is given."),
    invert: z
      .boolean()
      .default(false)
      .describe("Flip light<->heavy for drawn glyphs; background spaces stay blank."),
    map: z
      .record(z.string().min(1), z.string().min(1))
      .optional()
      .describe("Explicit source-char -> target-char substitutions. When given, replaces the density remap."),
  },
  async ({ text, path: srcPath, ramp, ramp_preset, invert, map }) => {
    try {
      let source = text;
      if (source === undefined && srcPath) {
        source = await fs.readFile(srcPath, "utf-8");
      }
      if (source === undefined) {
        source = canvas.render();
      }
      if (!source.trim()) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Nothing to restyle — provide `text`, a `path`, or draw on the canvas first.",
            },
          ],
        };
      }
      const lines = restyleAscii(source, {
        ramp: ramp ?? RAMPS[ramp_preset],
        invert,
        map,
      });
      const cols = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
      const rows = lines.length;
      canvas.reset(Math.max(1, cols), Math.max(1, rows));
      canvas.drawBlock(0, 0, lines.join("\n"));
      const how =
        map && Object.keys(map).length > 0
          ? "an explicit map"
          : `the '${ramp ? "custom" : ramp_preset}' palette`;
      return ok(
        `Restyled ${rows} lines onto ${how} (${cols}x${rows}). The canvas now holds the result — render or save it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `restyle_ascii failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "shape_text",
  "Pack a poem or phrase into a silhouette so the words themselves form the picture — a calligram. Give it `text` plus either a builtin `shape` (circle, heart, diamond, star, butterfly, triangle, tree, arrow) or an image `path` whose subject becomes the outline. The words trace the shape; by default the text repeats to fill it, and tall shapes like `tree` and `arrow` default to an upright silhouette (canopy + word-trunk). Set `outline` to wrap the figure in a crisp braille contour drawn at sub-pixel resolution while the words fill the body. This is the one-call way to make structured typographic illustrations.",
  {
    text: z.string().min(1).describe("The words to pour into the shape (a poem, a phrase)."),
    shape: z
      .enum(BUILTIN_SHAPES as [string, ...string[]])
      .optional()
      .describe("A builtin silhouette. Provide this or `path`."),
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Image file whose subject becomes the silhouette. Provide this or `shape`."),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    width: z.number().int().min(4).max(400).default(60).describe("Silhouette width in characters."),
    height: z
      .number()
      .int()
      .min(2)
      .max(400)
      .optional()
      .describe("Silhouette height. Defaults from the shape's natural aspect (round shapes ~width/2, tree/arrow taller)."),
    repeat: z
      .boolean()
      .default(true)
      .describe("Loop the text to fill the whole shape. Off = write it once, then stop."),
    justify: z
      .enum(["left", "center", "full"])
      .default("full")
      .describe(
        "How each row fills its span: full block-justifies words edge to edge (densest, default); center or left keep single spacing.",
      ),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Image mask only: luminance cutoff — cells darker than this are inside the shape."),
    invert: z
      .boolean()
      .default(false)
      .describe("Image mask only: treat bright cells as the subject instead of dark ones."),
    outline: z
      .boolean()
      .default(false)
      .describe("Trace the silhouette's edge with fine braille dots (sub-pixel resolution) while the interior fills with text."),
  },
  async ({ text, shape, path: imgPath, x, y, width, height, repeat, justify, threshold, invert, outline }) => {
    if (!shape && !imgPath) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "Provide either `shape` or `path`." }],
      };
    }
    try {
      const lines = await shapeText(
        text,
        { shape: shape as never, path: imgPath },
        { width, height, repeat, justify, threshold, invert, outline },
      );
      // Stamp only non-space cells so the calligram layers over existing art.
      let placed = 0;
      for (let ry = 0; ry < lines.length; ry++) {
        const line = lines[ry];
        for (let rx = 0; rx < line.length; rx++) {
          if (line[rx] !== " ") {
            canvas.setChar(x + rx, y + ry, line[rx]);
            placed++;
          }
        }
      }
      const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
      const rows = lines.length;
      const via = shape ? `the '${shape}' shape` : `image ${imgPath}`;
      return ok(
        `Shaped the text into ${via}: ${placed} glyphs across ${cols}x${rows} at (${x}, ${y}). Size the canvas at least ${x + cols}x${y + rows} to fit it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `shape_text failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "draw_icon",
  "Stamp a clean pictographic icon onto the canvas as high-resolution Unicode braille line-art, in the flat, two-tone, hand-inked spirit of the Claude blog's spot illustrations. Either pick a builtin `name` (" +
    ICON_NAMES.join(", ") +
    ") or give an image `path` (SVG, PNG, ...) to **trace any flat illustration or logo** into the same braille-icon style — the blog's own art traces cleanly. `size` sets the width in cells (height auto). Filled shapes become solid ink, strokes stay fine lines. `weight` thickens the linework (scales the pen for a builtin, dilates thin strokes for a traced image); for a traced image, `threshold` sets the ink cutoff. `invert` flips ink/paper (use it for light-on-dark art). Great as a bullet, a badge, a header mark, or a motif beside a title.",
  {
    name: z
      .enum(ICON_NAMES as [string, ...string[]])
      .optional()
      .describe("Which icon to draw from the builtin library. Provide this or `path`."),
    path: z
      .string()
      .min(1)
      .optional()
      .describe("Image file (SVG/PNG/...) to trace into a braille icon. Provide this or `name`."),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    size: z
      .number()
      .int()
      .min(4)
      .max(120)
      .default(18)
      .describe("Icon width in characters. Height is auto (a builtin reads square)."),
    weight: z
      .number()
      .min(0.3)
      .max(4)
      .default(1)
      .describe(
        "Stroke thickness. Higher = bolder, inkier lines. For a builtin it scales the pen; for a traced image it dilates thin line art so it reads solid.",
      ),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Traced image only: luminance cutoff — pixels darker than this become ink."),
    invert: z
      .boolean()
      .default(false)
      .describe("Swap ink and paper (draw as negative space, or trace light-on-dark art)."),
    transparent: z
      .boolean()
      .default(true)
      .describe("Layer the icon over existing art (blank cells are skipped). Off = paste opaquely."),
  },
  async ({ name, path: imgPath, x, y, size, weight, threshold, invert, transparent }) => {
    if (!name && !imgPath) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "Provide either `name` or `path`." }],
      };
    }
    try {
      const lines = imgPath
        ? await traceToBrailleLines(imgPath, {
            maxWidth: size,
            threshold,
            invert,
            grow: Math.max(0, Math.round((weight - 1) * 2)),
          })
        : iconToBrailleLines(name as string, size, { weight, invert });
      canvas.drawBlock(x, y, lines.join("\n"), transparent);
      const cols = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
      const rows = lines.length;
      const via = imgPath ? `traced ${imgPath}` : `the '${name}' icon`;
      return ok(
        `Drew ${via}: ${cols}x${rows} cells at (${x}, ${y}). Size the canvas at least ${x + cols}x${y + rows} to fit it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `draw_icon failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "illustrate",
  "Draw real two-tone VECTOR art in the flat, hand-inked style of blog-style spot illustrations — filled organic shapes, no outlines, a strict ink/cream/clay palette. This is a PURE art generator that returns an SVG plus a PNG preview; it is standalone and does NOT touch the ASCII canvas or the gallery. Pick a builtin `motif` (" +
    MOTIF_NAMES.join(", ") +
    "). The PNG renders inline so you can see it; the SVG source is returned as text; both are written to mcp/out/. `size` is the pixel size; `accent` toggles the highlight; `accentColor` picks its hue (" +
    ACCENT_NAMES.join(", ") +
    ", or a #rrggbb); `background` is paper (cream), none (transparent), or ink (dark); `seed` reshuffles the hand-drawn wobble; `invert` makes it light-on-dark; `roughness`/`weight`/`sketch` restyle the drawn line from clean and geometric to loose, and thin to bold.",
  {
    motif: z
      .enum(MOTIF_NAMES as [string, ...string[]])
      .describe("Which builtin motif to draw."),
    size: z
      .number()
      .int()
      .min(64)
      .max(4000)
      .default(1000)
      .describe("Output size in pixels (square for motifs)."),
    accent: z
      .boolean()
      .default(true)
      .describe("Draw the accent shapes at all (motifs only)."),
    accentColor: z
      .string()
      .optional()
      .describe(
        "Accent hue (motifs only): a name (" +
          ACCENT_NAMES.join(", ") +
          ") or a #rrggbb. Defaults to clay.",
      ),
    background: z
      .enum(["paper", "none", "ink"])
      .default("paper")
      .describe("Backdrop: 'paper' cream, 'none' transparent, or 'ink' dark."),
    seed: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .default(7)
      .describe("Deterministic seed for the hand-drawn wobble (motifs only)."),
    invert: z
      .boolean()
      .default(false)
      .describe("Swap ink and paper for light-on-dark art."),
    roughness: z
      .number()
      .min(0)
      .max(4)
      .optional()
      .describe("Motifs only: hand-drawn wobble scale — 0 clean/geometric, 1 default, up to 4 loose."),
    weight: z
      .number()
      .min(0.2)
      .max(4)
      .optional()
      .describe("Motifs only: ink line-thickness scale for the drawn strokes (default 1)."),
    sketch: z
      .boolean()
      .default(false)
      .describe("Motifs only: a looser, sketchier hand (preset; roughness/weight override it)."),
    name: z
      .string()
      .max(80)
      .optional()
      .describe("Base filename for the saved files (defaults to the motif name)."),
  },
  async ({ motif, size, accent, accentColor, background, seed, invert, roughness, weight, sketch, name }) => {
    try {
      const svg = illustrate({ motif, size, accent, accentColor, background, seed, invert, roughness, weight, sketch });

      // Render an inline preview (capped so the base64 stays light) and a
      // full-size PNG for disk.
      const previewPng = await rasterize(svg, Math.min(size, 640));
      const fullPng = await rasterize(svg, size);

      await fs.mkdir(OUT_DIR, { recursive: true });
      const base = slugify(name ?? motif);
      await fs.writeFile(path.join(OUT_DIR, `${base}.svg`), svg, "utf-8");
      await fs.writeFile(path.join(OUT_DIR, `${base}.png`), fullPng);

      return {
        content: [
          {
            type: "image" as const,
            data: previewPng.toString("base64"),
            mimeType: "image/png",
          },
          {
            type: "text" as const,
            text:
              `Drew motif '${motif}' as blog-style vector art (${size}x${size}). ` +
              `Saved ${base}.svg and ${base}.png to mcp/out/.\n\n${svg}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `illustrate failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "illustrate_scene",
  "Compose SEVERAL builtin motifs into one blog-style vector PLATE — a single SVG (plus PNG preview) with each motif placed, scaled, and rotated in the flat ink/cream/clay language. Like `illustrate`, but for a whole arrangement. Give `motifs` (a list auto-arranged by `layout`: focal, grid, row, column, or scatter — `focal` is the default and reads best, a hero motif ringed by smaller satellites) for the quick path, or `placements` for exact control (each: motif + center x/y in 0..1000, scale, rotate, optional accent/accentColor/seed). Shared knobs: `size`, `background` (paper/none/ink), `seed`, `invert`, scene-wide `accent`/`accentColor`, `roughness`/`weight`/`sketch` line style, and `pad` (margin around auto cells). Standalone: writes to mcp/out/ and never touches the ASCII gallery. Motifs: " +
    MOTIF_NAMES.join(", ") +
    ".",
  {
    motifs: z
      .array(z.enum(MOTIF_NAMES as [string, ...string[]]))
      .min(1)
      .max(16)
      .optional()
      .describe("Motifs to auto-arrange by `layout`. Provide this or `placements`."),
    placements: z
      .array(
        z.object({
          motif: z.enum(MOTIF_NAMES as [string, ...string[]]),
          x: z.number().min(0).max(1000).optional().describe("Center X in the 1000-space (default 500)."),
          y: z.number().min(0).max(1000).optional().describe("Center Y in the 1000-space (default 500)."),
          scale: z.number().min(0.05).max(3).optional().describe("Motif scale (1 = full canvas)."),
          rotate: z.number().min(-180).max(180).optional().describe("Rotation in degrees about the motif center."),
          accent: z.boolean().optional(),
          accentColor: z.string().optional().describe("Accent hue for this motif (name or #rrggbb)."),
          seed: z.number().int().min(0).max(1_000_000).optional(),
        }),
      )
      .min(1)
      .max(16)
      .optional()
      .describe("Exact placements. Provide this or `motifs`."),
    layout: z
      .enum(["grid", "row", "column", "scatter", "focal"])
      .default("focal")
      .describe(
        "How `motifs` are auto-arranged. `focal` (default) makes the first motif a large hero ringed by smaller satellites linked with thin spokes; grid/row/column/scatter place every motif at the same weight.",
      ),
    size: z.number().int().min(64).max(4000).default(1000).describe("Output size in pixels (square)."),
    background: z.enum(["paper", "none", "ink"]).default("paper").describe("Backdrop: paper, none, or ink."),
    seed: z.number().int().min(0).max(1_000_000).default(7).describe("Deterministic seed for wobble and scatter."),
    invert: z.boolean().default(false).describe("Swap ink and paper for light-on-dark art."),
    accent: z.boolean().default(true).describe("Scene-wide accent toggle (a placement can override)."),
    accentColor: z.string().optional().describe("Scene-wide accent hue (name or #rrggbb; default clay)."),
    roughness: z.number().min(0).max(4).optional().describe("Wobble scale — 0 clean, 1 default, up to 4 loose."),
    weight: z.number().min(0.2).max(4).optional().describe("Ink line-thickness scale (default 1)."),
    sketch: z.boolean().default(false).describe("Looser, sketchier hand (preset)."),
    pad: z.number().min(0).max(0.9).optional().describe("Margin kept around each auto-laid cell (default 0.14)."),
    name: z.string().max(80).optional().describe("Base filename for the saved files (default 'scene')."),
  },
  async ({ motifs, placements, layout, size, background, seed, invert, accent, accentColor, roughness, weight, sketch, pad, name }) => {
    if ((!motifs || !motifs.length) && (!placements || !placements.length)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "Provide either `motifs` or `placements`." }],
      };
    }
    try {
      const svg = compose({
        motifs,
        placements,
        layout,
        size,
        background,
        seed,
        invert,
        accent,
        accentColor,
        roughness,
        weight,
        sketch,
        pad,
      });

      const previewPng = await rasterize(svg, Math.min(size, 640));
      const fullPng = await rasterize(svg, size);

      await fs.mkdir(OUT_DIR, { recursive: true });
      const base = slugify(name ?? "scene");
      await fs.writeFile(path.join(OUT_DIR, `${base}.svg`), svg, "utf-8");
      await fs.writeFile(path.join(OUT_DIR, `${base}.png`), fullPng);

      const count = placements?.length ?? motifs?.length ?? 0;
      return {
        content: [
          {
            type: "image" as const,
            data: previewPng.toString("base64"),
            mimeType: "image/png",
          },
          {
            type: "text" as const,
            text:
              `Composed ${count} motifs as a blog-style vector plate (${size}x${size}). ` +
              `Saved ${base}.svg and ${base}.png to mcp/out/.\n\n${svg}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `illustrate_scene failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "illustrate_prompt",
  "Turn a short natural-language phrase into blog-style vector art by DETERMINISTICALLY mapping its words to a motif (or several), an accent hue, a line style, a layout, and a backdrop — then drawing them with the procedural engine. This is plain keyword + synonym matching (no model, offline, reproducible per phrase), so keep the phrase concrete and name the thing(s) to draw: e.g. \"a rough sketch of a brain and a blue spark on dark\", \"gear, spark and atom in a grid\", \"a bold clean magnifier\". Two or more motifs compose into one plate; `grid`/`row`/`column`/`scatter` (and cues like \"next to\", \"stacked\", \"scattered\") set the layout; colour words or a #rrggbb set the accent; \"rough\"/\"clean\"/\"bold\"/\"thin\"/\"sketchy\" restyle the line; \"on dark\", \"transparent\", or \"no accent\" change the backdrop. Returns the art plus a readback of what it understood, and writes .svg/.png to mcp/out/ (standalone — never the ASCII gallery). For exact motif names and full control, use `illustrate` / `illustrate_scene`.",
  {
    prompt: z
      .string()
      .min(1)
      .max(200)
      .describe('A short phrase naming what to draw, e.g. "a rough brain and a blue spark on dark".'),
    size: z.number().int().min(64).max(4000).default(1000).describe("Output size in pixels (square)."),
    seed: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .optional()
      .describe("Override the wobble seed (default: a stable hash of the phrase)."),
    name: z.string().max(80).optional().describe("Base filename for the saved files (default: the motif name)."),
  },
  async ({ prompt, size, seed, name }) => {
    try {
      const { svg, interpretation } = illustrateFromPrompt(prompt, { size, seed });

      const previewPng = await rasterize(svg, Math.min(size, 640));
      const fullPng = await rasterize(svg, size);

      await fs.mkdir(OUT_DIR, { recursive: true });
      const fallback =
        interpretation.kind === "single" ? interpretation.motif : interpretation.motifs.join("-");
      const base = slugify(name ?? fallback ?? "sketch");
      await fs.writeFile(path.join(OUT_DIR, `${base}.svg`), svg, "utf-8");
      await fs.writeFile(path.join(OUT_DIR, `${base}.png`), fullPng);

      const ignored = interpretation.unknown.length
        ? ` (ignored: ${interpretation.unknown.join(", ")})`
        : "";
      return {
        content: [
          {
            type: "image" as const,
            data: previewPng.toString("base64"),
            mimeType: "image/png",
          },
          {
            type: "text" as const,
            text:
              `Read "${prompt}" as: ${interpretation.summary}${ignored}. ` +
              `Saved ${base}.svg and ${base}.png to mcp/out/.\n\n${svg}`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `illustrate_prompt failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "block_diagram",
  "Draw an architecture diagram: a sequence of labeled boxes joined by connectors — the structured counterpart to shape_text. Give it `blocks` (each a label; use \\n for a multi-line label) and it lays them out as boxes with arrows between, sized to the longest label. Perfect for a transformer stack, a pipeline, or a flow chart. Choose `direction` (down/up/right/left), `style` (unicode rounded, ascii, or double lines), and an optional `title`.",
  {
    blocks: z
      .array(z.string().min(1))
      .min(1)
      .max(40)
      .describe("The labels, in flow order. Each becomes a box; use \\n for multiple lines."),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    direction: z
      .enum(["down", "up", "right", "left"])
      .default("down")
      .describe("Flow direction. down/up stack vertically; right/left run horizontally."),
    style: z
      .enum(["unicode", "ascii", "double"])
      .default("unicode")
      .describe("Box charset: unicode (rounded), ascii (portable +-|), or double lines."),
    connector: z
      .enum(["arrow", "line", "none"])
      .default("arrow")
      .describe("What joins the boxes: an arrowhead, a plain line, or nothing."),
    gap: z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(1)
      .describe("Connector length in cells between boxes."),
    pad_x: z
      .number()
      .int()
      .min(0)
      .max(12)
      .default(2)
      .describe("Horizontal padding inside each box."),
    align: z.enum(["left", "center", "right"]).default("center"),
    title: z.string().optional().describe("Optional heading centered above the diagram."),
  },
  async ({ blocks, x, y, direction, style, connector, gap, pad_x, align, title }) => {
    try {
      const lines = blockDiagram(blocks, {
        direction,
        style,
        connector,
        gap,
        padX: pad_x,
        align,
        title,
      });
      // Stamp every cell (spaces included) so the boxes read as solid figures.
      for (let ry = 0; ry < lines.length; ry++) {
        const line = [...lines[ry]];
        for (let rx = 0; rx < line.length; rx++) {
          canvas.setChar(x + rx, y + ry, line[rx]);
        }
      }
      const cols = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
      const rows = lines.length;
      return ok(
        `Drew a ${blocks.length}-block ${direction} diagram: ${cols}x${rows} at (${x}, ${y}). Size the canvas at least ${x + cols}x${y + rows} to fit it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `block_diagram failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "tree_diagram",
  "Draw a hierarchy as a tree — the branching counterpart to block_diagram (which is a linear chain). Give it an indented `tree` outline (each deeper indent is a child) and it renders a real node-link tree: parents centered above their children, joined by box-drawing connectors. Great for a taxonomy, an org chart, a dependency or model-lineage tree. `layout: \"down\"` is the centered tree; `layout: \"list\"` is the file-tree ( |-- / `-- ) form. `boxed` wraps each node in a box.",
  {
    tree: z
      .string()
      .min(1)
      .describe(
        "Indented outline; each deeper indent level is a child. E.g. 'Claude\\n  Opus\\n  Sonnet\\n  Haiku'.",
      ),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    layout: z
      .enum(["down", "list"])
      .default("down")
      .describe("down: centered node-link tree. list: left-aligned file-tree."),
    style: z
      .enum(["unicode", "ascii"])
      .default("unicode")
      .describe("Connector charset: unicode box-drawing or portable 7-bit ascii."),
    boxed: z
      .boolean()
      .default(false)
      .describe("Wrap each node in a box (down layout only)."),
    gap_x: z
      .number()
      .int()
      .min(1)
      .max(24)
      .default(3)
      .describe("Columns between sibling subtrees (down layout)."),
    title: z.string().optional().describe("Optional heading centered above the tree."),
  },
  async ({ tree, x, y, layout, style, boxed, gap_x, title }) => {
    try {
      const lines = treeDiagram(tree, { layout, style, boxed, gapX: gap_x, title });
      if (lines.length === 0) return ok("Tree was empty — nothing drawn.");
      for (let ry = 0; ry < lines.length; ry++) {
        const line = [...lines[ry]];
        for (let rx = 0; rx < line.length; rx++) {
          canvas.setChar(x + rx, y + ry, line[rx]);
        }
      }
      const cols = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
      const rows = lines.length;
      return ok(
        `Drew a ${layout} tree: ${cols}x${rows} at (${x}, ${y}). Size the canvas at least ${x + cols}x${y + rows} to fit it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `tree_diagram failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "banner_text",
  "Render a short phrase as big block letters — display type, the way shape_text and the diagram tools each turn meaning into a picture. Give it `text` and it lays out each character as a 5-row glyph (A-Z, 0-9, space, and a little punctuation); lowercase is upper-cased. Use \\n to stack multiple banner rows. Great for a headline atop a piece or a title card. `style` picks the ink charset (unicode solid block or ascii `#`); `fill` overrides it with any character.",
  {
    text: z
      .string()
      .min(1)
      .describe("The phrase to enlarge. Use \\n to stack multiple banner rows."),
    x: z.number().int().default(0),
    y: z.number().int().default(0),
    style: z
      .enum(["unicode", "ascii"])
      .default("unicode")
      .describe("Ink charset: unicode (solid block) or ascii (#)."),
    fill: z
      .string()
      .min(1)
      .max(1)
      .optional()
      .describe("Explicit ink character; overrides `style`."),
    gap: z
      .number()
      .int()
      .min(0)
      .max(8)
      .default(1)
      .describe("Blank columns between letters."),
  },
  async ({ text, x, y, style, fill, gap }) => {
    try {
      const lines = bannerText(text, { style, fill, gap });
      if (lines.length === 0) return ok("Nothing to render.");
      for (let ry = 0; ry < lines.length; ry++) {
        const line = [...lines[ry]];
        for (let rx = 0; rx < line.length; rx++) {
          canvas.setChar(x + rx, y + ry, line[rx]);
        }
      }
      const cols = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
      const rows = lines.length;
      return ok(
        `Drew a banner: ${cols}x${rows} at (${x}, ${y}). Size the canvas at least ${x + cols}x${y + rows} to fit it.`,
      );
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `banner_text failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

server.tool(
  "draw_line",
  "Draw a straight line of a character between two points.",
  {
    // Bound the endpoints (off-canvas is fine; the canvas caps at 400) so a
    // pathological coordinate can't spin Bresenham for billions of iterations
    // and hang the single, synchronous canvas process.
    x1: z.number().int().min(-1000).max(1000),
    y1: z.number().int().min(-1000).max(1000),
    x2: z.number().int().min(-1000).max(1000),
    y2: z.number().int().min(-1000).max(1000),
    char: z.string().min(1).max(1).default("*"),
  },
  async ({ x1, y1, x2, y2, char }) => {
    canvas.drawLine(x1, y1, x2, y2, char);
    return ok(`Drew line (${x1},${y1})→(${x2},${y2}) with '${char}'.`);
  },
);

server.tool(
  "draw_rect",
  "Draw a rectangle. Set filled=true to fill it, otherwise only the border is drawn.",
  {
    x: z.number().int(),
    y: z.number().int(),
    // Cap the extent like new_canvas/crop/resize_canvas do: the loop runs over
    // the requested size (not the ≤400 canvas), so an unbounded value hangs the
    // synchronous process even though nothing off-canvas is drawn.
    width: z.number().int().min(1).max(400),
    height: z.number().int().min(1).max(400),
    char: z.string().min(1).max(1).default("#"),
    filled: z.boolean().default(false),
  },
  async ({ x, y, width, height, char, filled }) => {
    canvas.drawRect(x, y, width, height, char, filled);
    return ok(`Drew ${filled ? "filled " : ""}rect at (${x},${y}) ${width}x${height}.`);
  },
);

server.tool(
  "fill_gradient",
  "Fill a rectangular region with a density gradient (empty to full along a direction). Ideal for skies, fog, fades, and atmospheric depth without needing an image.",
  {
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(1).max(400),
    height: z.number().int().min(1).max(400),
    ramp: z
      .string()
      .min(2)
      .max(64)
      .default(DENSITY_RAMP)
      .describe("Density ramp from empty to full."),
    direction: z
      .enum(["down", "up", "left", "right", "radial"])
      .default("down"),
  },
  async ({ x, y, width, height, ramp, direction }) => {
    canvas.fillGradient(x, y, width, height, ramp, direction);
    return ok(`Filled a ${width}x${height} ${direction} gradient at (${x}, ${y}).`);
  },
);

server.tool(
  "scatter",
  "Scatter a character across a region with a density from 0 to 1. Great for stars, stippling, grain, and organic texture. Only empty cells are filled, so it layers over existing art.",
  {
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(1).max(400),
    height: z.number().int().min(1).max(400),
    char: z.string().min(1).max(1).default("."),
    density: z.number().min(0).max(1).default(0.1),
  },
  async ({ x, y, width, height, char, density }) => {
    canvas.scatter(x, y, width, height, char, density);
    return ok(`Scattered '${char}' over ${width}x${height} at (${x}, ${y}) at density ${density}.`);
  },
);

server.tool(
  "erase",
  "Clear a single cell (set it back to a space).",
  { x: z.number().int(), y: z.number().int() },
  async ({ x, y }) => {
    canvas.erase(x, y);
    return ok(`Erased (${x}, ${y}).`);
  },
);

server.tool(
  "clear_canvas",
  "Erase everything on the current canvas, keeping its size.",
  {},
  async () => {
    canvas.clear();
    return ok("Canvas cleared.");
  },
);

server.tool(
  "trim",
  "Auto-crop the blank margins around the drawing so the canvas hugs the content (like the gallery save does, but in place). Treats an ASCII space and the braille-blank as margin. `pad` keeps a border of that many blank cells. A fully blank canvas collapses to 1x1.",
  {
    pad: z
      .number()
      .int()
      .min(0)
      .max(50)
      .default(0)
      .describe("Blank-cell border to keep around the content."),
  },
  async ({ pad }) => {
    const { width, height } = canvas.trim(pad);
    return ok(`Trimmed to ${width}x${height}.`);
  },
);

server.tool(
  "crop",
  "Crop the canvas to a rectangle; the cut-out becomes the new canvas. Cells outside the current grid become blank. Use it to frame a detail, cut a subject out of a larger render, or fix an oversized canvas.",
  {
    x: z.number().int().describe("Left edge of the crop (canvas column)."),
    y: z.number().int().describe("Top edge of the crop (canvas row)."),
    width: z.number().int().min(1).max(400).describe("Crop width in cells."),
    height: z.number().int().min(1).max(400).describe("Crop height in cells."),
  },
  async ({ x, y, width, height }) => {
    canvas.crop(x, y, width, height);
    return ok(`Cropped to ${canvas.width}x${canvas.height} at (${x}, ${y}).`);
  },
);

server.tool(
  "frame",
  "Wrap the whole canvas in a box-drawing border, growing it by one cell (plus `padding`) on each side. An optional `title` sits centered on the top edge. Trim first for a border that hugs the art — great for a gallery card.",
  {
    style: z
      .enum(["unicode", "round", "double", "bold", "ascii"])
      .default("unicode")
      .describe("Border look: 'unicode' (┌─┐), 'round' (╭─╮), 'double' (╔═╗), 'bold' (┏━┓), or 'ascii' (+-+)."),
    title: z
      .string()
      .max(80)
      .default("")
      .describe("Optional caption centered on the top edge."),
    padding: z
      .number()
      .int()
      .min(0)
      .max(20)
      .default(0)
      .describe("Blank cells between the art and the border."),
  },
  async ({ style, title, padding }) => {
    const { width, height } = canvas.frame(style, title, padding);
    return ok(`Framed to ${width}x${height}${title ? ` titled "${title}"` : ""}.`);
  },
);

server.tool(
  "flip",
  "Mirror the canvas. 'horizontal' flips left-right, 'vertical' flips top-bottom. Mirror-able drawing glyphs (slashes, brackets, box corners) are swapped so line art stays coherent; letters are left as-is. Great for building symmetry.",
  {
    axis: z
      .enum(["horizontal", "vertical"])
      .default("horizontal")
      .describe("'horizontal' = left-right mirror, 'vertical' = top-bottom mirror."),
  },
  async ({ axis }) => {
    canvas.flip(axis);
    return ok(`Flipped ${axis}.`);
  },
);

server.tool(
  "resize_canvas",
  "Resize the canvas without redrawing — keep the existing art and re-anchor it. Growing pads with blanks; shrinking crops what falls outside. Use it to add margin, reposition a drawing, or make room before compositing.",
  {
    width: z.number().int().min(1).max(400).describe("New canvas width in cells."),
    height: z.number().int().min(1).max(400).describe("New canvas height in cells."),
    anchor: z
      .enum([
        "top-left", "top", "top-right",
        "left", "center", "right",
        "bottom-left", "bottom", "bottom-right",
      ])
      .default("top-left")
      .describe("Where to hold the existing art as the canvas resizes."),
  },
  async ({ width, height, anchor }) => {
    const size = canvas.resize(width, height, anchor);
    return ok(`Resized to ${size.width}x${size.height} (anchor ${anchor}).`);
  },
);

server.tool(
  "render",
  "Return the current canvas as plain ASCII text so you can see what you've drawn.",
  {},
  async () => ok(canvas.render() || "(empty canvas)"),
);

server.tool(
  "save_to_gallery",
  "Publish the current drawing. With the public backend configured it appears on the site's home page; otherwise it is saved to a local gallery folder.",
  { title: z.string().min(1).max(80) },
  async ({ title }) => {
    if (canvas.isEmpty()) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "Nothing to save — draw something first." }],
      };
    }
    const art = canvas.toTrimmedText();
    try {
      // Publish to the shared public gallery when a backend is configured;
      // otherwise fall back to writing a local file in a gitignored scratch
      // folder (the site no longer auto-loads local files; the wall is served
      // from the database).
      if (remoteEnabled) {
        const okRemote = await publishRemote(title, art, displayAuthor());
        if (!okRemote) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: "Backend rejected the submission (check the agent login and allow-list).",
              },
            ],
          };
        }
        return ok(`Published "${title}" to the public gallery.`);
      }

      const slug = slugify(title);
      await fs.mkdir(GALLERY_DIR, { recursive: true });
      await fs.writeFile(path.join(GALLERY_DIR, `${slug}.txt`), art + "\n", "utf-8");
      await recordAuthor(slug, displayAuthor());
      return ok(`Saved "${title}" to the local gallery (${slug}.txt).`);
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Failed to save: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  },
);

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with the stdio protocol (stdout).
  console.error(`ascii-canvas MCP server ready. Gallery: ${GALLERY_DIR}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
