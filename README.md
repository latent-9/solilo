# ascii-canvas — MCP server

Standalone repo of the ascii-canvas MCP server (originally part of the *asciiary* project).

An [MCP](https://modelcontextprotocol.io) server that lets any AI agent
(Claude Desktop, Claude Code, or any MCP client) **draw ASCII art and publish
it to the gallery**. Give your agent a canvas.

## Quick start (via npx — no clone)

Once the package is published to npm, any MCP client can launch the server in a
single line — no cloning, no build step. Point it at your public gallery and
whatever the agent draws lands on the shared wall everyone sees.

Claude Code:

```bash
claude mcp add ascii-canvas -- npx -y asciiary-ascii-mcp
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ascii-canvas": {
      "command": "npx",
      "args": ["-y", "asciiary-ascii-mcp"],
      "env": {
        "SUPABASE_URL": "https://xxxx.supabase.co",
        "SUPABASE_ANON_KEY": "your-anon-public-key"
      }
    }
  }
}
```

With the `SUPABASE_*` variables set, drawings publish straight to the public
gallery (see `supabase/README.md` in the main asciiary project). Without them, the
server falls back to writing a local `.txt`, which is most useful when developing
against a cloned checkout — see [Build](#build) below.

## Tools

| Tool | What it does |
|---|---|
| `new_canvas(width, height)` | Start a fresh canvas |
| `set_char(x, y, char)` | Place one character |
| `draw_text(x, y, text)` | Write a line of text |
| `draw_block(x, y, text, transparent?)` | Place a multi-line block (pre-made art, or shaped/concrete poetry). Set `transparent` to **layer** the block over existing art — blank cells (space / braille-blank) are skipped instead of erasing what's underneath |
| `image_to_ascii(path, x?, y?, max_width?, invert?, ramp?, ramp_preset?, gamma?, auto_contrast?, edges?, edge_threshold?, dither?, transparent?)` | Convert an image file to ASCII and stamp it on the canvas. Defaults to jp2a's 23-step tonal ramp for smooth gradation; `ramp_preset` also offers `classic`, `blocks` (░▒▓█) and `braille`; `gamma` reshapes midtones; auto-contrast is on by default; `edges` adds structure-aware contour strokes ( `| - / \` ) for crisper silhouettes; `dither` (`bayer` ordered / `floyd` error-diffusion) fakes continuous tone from few ramp steps for a crisp 1-bit poster look; `transparent` composites the render over existing art instead of erasing it |
| `image_to_braille(path, x?, y?, max_width?, invert?, auto_contrast?, gamma?, threshold?, dither?, edges?, edge_threshold?, transparent?)` | Convert an image to **high-resolution Unicode braille** (⣿). Each cell is a 2x4 dot grid, so it renders at **2x the horizontal and 4x the vertical resolution** of `image_to_ascii` — the sharpest photo/logo/silhouette output here. Dots are 1-bit, so `dither` (default `floyd`) carries the tone; `dither: "none"` hard-thresholds for crisp line art; `edges` switches to **outline mode** — a Sobel pass at sub-pixel resolution that draws the image as a clean braille line drawing; `transparent` composites over existing art |
| `shape_text(text, shape? \| path?, x?, y?, width?, height?, repeat?, justify?, threshold?, invert?, outline?)` | Pour a poem into a silhouette so the **words form the picture** — a calligram. Pick a builtin `shape` (circle, heart, diamond, star, butterfly, triangle, tree, arrow) or an image `path` whose subject becomes the outline. `tree`/`arrow` default to a tall, upright figure — a word-trunk under a rounded canopy. Set `outline` to wrap the figure in a **crisp braille contour drawn at 2x4 sub-pixel resolution** while the words fill the body — the silhouette's edge reads far smoother than whole-cell steps |
| `draw_icon(name? \| path?, x?, y?, size?, weight?, threshold?, invert?, transparent?)` | Stamp a clean **pictographic icon** as high-resolution braille line-art, in the flat, two-tone, hand-inked spirit of the Claude blog's spot illustrations. Pick a builtin `name` from the library (arrow, bolt, bricks, chat, check, city, code, cube, gear, heart, key, magnifier, spark, star, terminal) **or** give an image `path` (SVG, PNG, ...) to **trace any flat illustration or logo** into the same style. `size` sets the width in cells; `weight` thickens the linework (scales the pen for a builtin, dilates thin strokes for a traced image); `threshold` sets the ink cutoff for a traced image; `invert` flips ink/paper for light-on-dark art. A bullet, badge, header mark, or motif beside a title |
| `illustrate(motif, size?, accent?, accentColor?, background?, seed?, invert?, roughness?, weight?, sketch?, name?)` | Draw **real two-tone VECTOR art** in the flat, hand-inked style of the [Claude blog](https://claude.com/blog)'s spot illustrations — filled organic shapes, no outlines, the blog's ink/cream palette plus one accent hue. **Standalone: this returns an SVG + a PNG preview and does *not* touch the ASCII canvas or gallery.** Pick a builtin `motif` from a library of 105 — objects (spark, chat, magnifier, cube, gear, heart, key, bricks, city, bolt, leaf, eye, star, terminal, brain, head, prism, atom), the more geometric **systems** set (node, grid, link, fanout, chip, beam, burst, mesh) drawn in the engineering blog's graph-and-module register, and seven themed sets: **dev** (prompt, window, braces, cursor, folder, document, commit, bug, stack, cloud), **body** (person, hand, foot, bone, ribcage, lungs, tooth, muscle, pulse, kidney), **AI** (circuit, neuron, layers, database, binary, signal, radar, token, vision, compass), **data** (barchart, linechart, piechart, gauge, histogram, funnel, meter, trend, scatterplot, candles) in the metrics-and-evaluation register, **medicine** (pill, tablet, syringe, flask, dna, cross, stethoscope, microscope, bandage, molecule), **robot** (robot, android, arm, gripper, rover, drone, antenna, battery, sensor, nut), and **nature** (sun, moon, mountain, tree, flame, droplet, wave, planet, snowflake, rainbow). `size` is the pixel size; `accent` toggles the accent shapes and `accentColor` picks their hue — a name (clay, rust, red, blue, pink, yellow, green, slate) or a `#rrggbb` (the multicolour motifs brain/head/prism/atom also bring their own spectrum); `background` is `paper`/`none`/`ink`; `seed` reshuffles the hand-drawn wobble; `invert` makes it light-on-dark; `roughness`/`weight`/`sketch` restyle the drawn line (clean-and-geometric to loose, thin to bold). Both files are written to `mcp/out/` |
| `illustrate_scene(motifs? \| placements?, layout?, size?, background?, seed?, invert?, accent?, accentColor?, roughness?, weight?, sketch?, pad?, name?)` | Compose **several** builtin motifs into one blog-style vector **plate** — the multi-motif companion to `illustrate`, same SVG + PNG output, same standalone (never touches the ASCII canvas or gallery). Give `motifs` (a list auto-arranged by `layout`: `focal`, `grid`, `row`, `column`, or `scatter` — `focal` is the default and reads best: a large hero motif ringed by smaller satellites linked with thin spokes) for the quick path, or `placements` for exact control — each entry is a `motif` plus a center `x`/`y` in the 1000-space, a `scale`, a `rotate`, and an optional per-motif `accent`/`accentColor`/`seed`. Shares every scene and line-style knob with `illustrate`; `pad` sets the margin kept around each auto-laid cell. Both files are written to `mcp/out/` |
| `illustrate_prompt(prompt, size?, seed?, name?)` | Draw from **plain words**: a short phrase like *"a rough brain and a blue spark on dark"* is mapped to a motif (or several), an accent hue, a line style, a layout, and a backdrop, then rendered through `illustrate`/`illustrate_scene`. The mapping is **deterministic keyword-and-synonym matching — no model, no network** — so a phrase always draws the same plate, and it only ever *composes* the builtin motifs (it never invents raw SVG paths). The response reads back exactly what it understood (and lists any words it ignored). Same SVG + PNG output to `mcp/out/`, still standalone (never touches the ASCII canvas or gallery) |
| `restyle_ascii(text? \| path?, ramp?, ramp_preset?, invert?, map?)` | **Re-skin existing ASCII art** with a new character palette. Swaps every glyph for the matching-darkness character in a target ramp — `classic`, `jp2a`, `blocks` (░▒▓█), `braille`, or a custom `ramp` — while keeping the picture. Give an explicit `map` for exact char→char substitution. Source is `text`, a `.txt` `path`, or the current canvas; the result replaces the canvas |
| `block_diagram(blocks, x?, y?, direction?, style?, connector?, gap?, pad_x?, align?, title?)` | Draw an **architecture diagram** — labeled boxes joined by arrows. Stack them `down`/`up` (a transformer block) or run them `right`/`left` (a pipeline); `style` picks unicode/ascii/double borders |
| `tree_diagram(tree, x?, y?, layout?, style?, boxed?, gap_x?, title?)` | Draw a **hierarchy** — the branching counterpart to `block_diagram`. Give it an indented outline; `layout: "down"` centers each parent over its children with box-drawing connectors, `layout: "list"` is the file-tree ( `\|--` / `` `-- `` ) form. Good for a taxonomy, org chart, or model-lineage tree |
| `banner_text(text, x?, y?, style?, fill?, gap?)` | Render a short phrase as **big block letters** — display type for a headline or title card. Each character becomes a 5-row glyph (A-Z, 0-9, space, some punctuation); lowercase is upper-cased and `\n` stacks rows. `style` picks the ink (unicode solid block or ascii `#`); `fill` sets any ink character |
| `draw_line(x1, y1, x2, y2, char?)` | Straight line (Bresenham) |
| `draw_rect(x, y, width, height, char?, filled?)` | Rectangle, outline or filled |
| `fill_gradient(x, y, width, height, ramp?, direction?)` | Density gradient fill — skies, fog, fades |
| `scatter(x, y, width, height, char?, density?)` | Stipple a character over a region — stars, grain, texture |
| `erase(x, y)` / `clear_canvas()` | Erase a cell / the whole canvas |
| `trim(pad?)` | Auto-crop blank margins so the canvas hugs the content (space **and** braille-blank count as margin); `pad` keeps a border. A blank canvas collapses to 1x1 |
| `crop(x, y, width, height)` | Cut the canvas down to a rectangle — frame a detail or cut a subject out; out-of-range cells become blank |
| `frame(style?, title?, padding?)` | Wrap the canvas in a box-drawing border (`unicode` ┌─┐, `round` ╭─╮, `double` ╔═╗, `bold` ┏━┓, `ascii` +-+) with an optional centered `title`. `trim` first for a snug gallery card |
| `flip(axis?)` | Mirror the canvas left-right or top-bottom; mirror-able glyphs (`/ \ ( ) < > [ ] { }`, box corners) are swapped so line art stays coherent. Mirror a half over itself (with `draw_block transparent`) to build symmetry |
| `resize_canvas(width, height, anchor?)` | Resize without redrawing — grow to add margin or shrink to crop, holding the art at an `anchor` (`top-left` … `center` … `bottom-right`) |
| `render()` | Return the canvas as plain ASCII so the agent can see it |
| `save_to_gallery(title)` | **Publish** the drawing to the public wall (Supabase). Without a backend configured it falls back to a local `.txt` in a gitignored scratch folder |

The loop: an agent draws with these tools, calls `save_to_gallery`, and the art
is published to the public wall (Supabase) that the website's home page loads at
runtime. Without a backend configured it falls back to a local `.txt` in the
gitignored `mcp/.local-gallery` folder.

## How the picture tools work

Two tools go past plain character placement, and their methods are adapted from
published work rather than guessed at:

- **`image_to_ascii` — tone (jp2a) plus structure (Xu).** For density it
  box-averages the image and maps each cell through a ramp — the method of
  [`jp2a`](https://github.com/cslarsen/jp2a), whose 23-step tonal ramp is the
  default here for smooth gradation (jp2a is GPL-2.0; only that short ramp
  constant is reused, reimplemented, so this MIT project stays MIT — see
  `NOTICE` in the main asciiary project). A `gamma` control reshapes the midtones, which jp2a's linear
  mapping doesn't. On top of that it can run a Sobel pass (`edges`) that traces
  contours as directional strokes ( `| - / \` ) — the structure-first idea from
  Xu, Zhang & Wong, *Structure-based ASCII Art* (SIGGRAPH 2010), which
  approximates an image's line structure with glyph shapes instead of only
  matching grey levels.
- **`image_to_braille` — sub-pixel 1-bit rendering.** Unicode braille cells
  (U+2800..U+28FF) each carry a 2x4 dot grid, so one glyph is eight
  independently-toggled dots. Rendering an image onto that grid gives 2x the
  horizontal and 4x the vertical resolution of one-glyph-per-cell density art —
  the approach of [`drawille`](https://github.com/asciimoo/drawille) and jp2a's
  braille mode. Because each dot is on/off, dithering (Floyd–Steinberg by
  default) is what carries the tone; `dither: "none"` hard-thresholds for crisp
  line art. An `edges` mode runs the same Sobel pass as `image_to_ascii`, but at
  sub-pixel resolution, lighting a dot only along steep gradients — the image
  becomes a clean braille line drawing (outer and inner contours both traced).
- **`shape_text` — a calligram engine.** A silhouette (a builtin shape or an
  image's subject) becomes a boolean mask; the poem's words are then packed only
  into the "inside" cells, so the text itself draws the picture. The mask-fill
  idea is borrowed from [`word_cloud`](https://github.com/amueller/word_cloud)
  (MIT) — it places words into a shape mask via an integral image on a pixel
  canvas; here each cell is one glyph, so we scan each row for inside-spans and
  greedily pack whole words into them. The lineage is Apollinaire's
  *Calligrammes* (1918): text laid out to trace an image. With `outline`, the
  same silhouette is resampled at braille sub-pixel resolution (2x4 dots per
  cell) and its inner rim is traced with braille glyphs — a smooth contour
  around the text body, sharing the dot layout with `image_to_braille`.
- **`draw_icon` — a pictogram library + a flat-art tracer.** Renders a small,
  clean icon as braille line-art in the flat, two-tone, hand-inked spirit of the
  [Claude blog](https://claude.com/blog)'s spot illustrations. It works two ways.
  A builtin `name` draws from a vector library (magnifier, gear, chat, code,
  terminal, city, bricks, cube, ...) rendered by a tiny sub-pixel pen — filled
  shapes become solid ink (⣿), strokes stay fine lines. An image `path` instead
  **traces** any flat illustration, logo, or silhouette (SVG/PNG/...) into the
  same style: it `flatten`s transparency onto paper white first — so a transparent
  ground reads as bright, not dark, which a tonal reader like `image_to_braille`
  would misjudge — then hard-thresholds the dark ink at 2x4 sub-pixel resolution.
  `weight` dilates thin line art so a delicate stroke reads as bold, solid ink.
  The blog's own SVGs trace cleanly through it.
- **`illustrate` — real vector art, not text.** Where `draw_icon` renders the
  blog look in braille dots, `illustrate` draws it as an actual **SVG**: the same
  1000x1000 canvas, root `fill="none"`, **no strokes at all**, just a handful of
  FILLED organic paths in the blog's inks — near-black `#141413`, warm cream
  `#FAF9F5`, and an accent that is warm clay `#D97757` by default but can be any
  of a small hand-tuned palette (red, blue, pink, yellow, green, plus the
  engineering blog's muted `slate`) or a raw
  `#rrggbb`, set with `accentColor`; the multicolour motifs (brain, head, prism,
  atom) paint several accents at once. A tiny procedural engine builds each motif
  from hand-inked primitives (wobbling blobs via Catmull-Rom splines, filled
  ink-stroke ribbons, evenodd rings, leaves, stars), with a deterministic `seed`
  so a given motif is reproducible yet organic. Alongside the object motifs, a
  more geometric **systems** set (node, grid, link, fanout, chip, beam, burst,
  mesh) draws the engineering blog's graph-and-module vocabulary — hub-and-spoke
  networks, cell lattices, edges, fan-outs, framed components, I-beams, radial
  bursts, node ladders — from the same primitives. Seven themed sets extend the
  library further: a developer's desk (prompt, window, braces, cursor, folder,
  document, commit, bug, stack, cloud), the human body (person, hand, foot, bone,
  ribcage, lungs, tooth, muscle, pulse, kidney), machine learning (circuit,
  neuron, layers, database, binary, signal, radar, token, vision, compass), data
  (barchart, linechart, piechart, gauge, histogram, funnel, meter, trend,
  scatterplot, candles), medicine (pill, tablet, syringe, flask, dna, cross,
  stethoscope, microscope, bandage, molecule), robotics (robot, android, arm,
  gripper, rover, drone, antenna, battery, sensor, nut), and nature (sun, moon,
  mountain, tree, flame, droplet, wave, planet, snowflake, rainbow) — 105 motifs
  in all. Output is a real
  SVG plus a PNG preview, written to `mcp/out/` —
  a pure art generator, entirely separate from the ASCII wall. Three line-style
  knobs restyle that same geometry without touching the palette: `roughness`
  scales the hand-drawn wobble (0 is ruler-clean, 4 is loose), `weight` scales
  the ink line thickness, and `sketch` is a looser preset. They drive a small
  render-state the primitives read, so the defaults stay byte-identical — and the
  engine also carries texture primitives (parallel hatching, stipple dots, dashed
  ribbons) for future motifs, all filled paths in the same stroke-free language.
- **`illustrate_scene` — many motifs, one plate.** The composition companion to
  `illustrate`: it renders several motifs into their own sub-scenes and places
  each one with an SVG `<g transform>` (translate, scale, rotate about the motif's
  center), assembling a single blog-style plate. Hand it `motifs` + a `layout`
  (`grid`, `row`, `column`, or `scatter`) to auto-arrange, or `placements` to set
  each motif's position, scale, rotation, and accent by hand. It shares the scene
  and line-style knobs, stays deterministic per `seed`, and writes the same
  SVG + PNG to `mcp/out/` — still entirely separate from the ASCII wall.
- **`illustrate_prompt` — plain words in, a plate out.** A short phrase becomes a
  drawing without anyone writing SVG. A tiny front-end normalizes the phrase and
  matches it against the motif names and a hand-built synonym table (cog->gear,
  lightning->bolt, "speech bubble"->chat, "magnifying glass"->magnifier, ...),
  reads accent hues (colour names or a raw `#rrggbb`), line style ("rough",
  "clean", "bold", "thin", "sketchy"), layout ("in a row", "in a grid", "stacked",
  "scattered"), and backdrop ("on dark", "transparent", "monochrome"), then renders
  through `illustrate` (one motif) or `illustrate_scene` (several). It is
  **deterministic and offline** — no model and no network are involved; the phrase
  is hashed to a stable seed, so the same words always draw the same plate — and it
  only ever *composes* the builtin motifs, never inventing raw paths. Multi-word
  cues are consumed so they can't leak ("hand drawn" sets the rough style without
  pulling in the `hand` motif); the reply reads back what it understood and names
  any words it ignored. If nothing matches a motif it says so instead of guessing.

### What they produce

`image_to_ascii`'s default ramp is jp2a's 23-step scale, which grades far more
smoothly than the coarse 10-step `classic` ramp. The same left-to-right fade in
each (via `fill_gradient`, which shares the ramps):

```
classic (10 steps)   .....:::::-----=====+++++*****#####%%%%%@@@
jp2a    (23 steps)      ......'',,;;::ccllooddxxkkOO00KKXXNNWWMM
```

`shape_text` pours a poem into a silhouette so the words draw the picture. Here a
few lines about a small mark, poured into the builtin `heart`:

```
       love is a       small mark
      that keeps meaning something
    long after the hand that made it
    is gone so i write it again and
   again until the shape is full love
   is a small mark that keeps meaning
   something long after the hand that
     made it is gone so i write it
   again and again until the shape is
     full love is a small mark that
      keeps meaning something long
      after the hand that made it
         is gone so i write it
         again and again until
           the shape is full
               love is a
                 small
                   ma
```

The `tree` shape is one call — a rounded canopy over a word-trunk that flares into
roots, so a whole idea (here the arc from Turing to agents) grows as one figure.
The trunk fills with the poem's short words instead of leaving a blank column:

```
                   Turing
                    1950
                 perceptron
               backprop LSTM
             word2vec attention
         transformer 2017 BERT GPT
     scaling RLHF alignment agents CoT
      reasoning Turing 1950 perceptron
   transformer 2017 BERT GPT scaling RLHF
   1950 perceptron backprop LSTM word2vec
    attention transformer 2017 BERT GPT
     scaling RLHF alignment agents CoT
      reasoning Turing 1950 perceptron
   transformer 2017 BERT GPT scaling RLHF
       alignment agents CoT reasoning
          LSTM word2vec attention
         transformer 2017 BERT GPT
           scaling RLHF alignment
                    LSTM
                    2017
                    BERT
                    GPT
                   agents
                    CoT
                 reasoning
                Turing 1950
                 perceptron
               backprop LSTM
```

`draw_icon` stamps a small pictogram in the same braille substrate. A builtin —
here the `magnifier` at `size: 18` — is drawn by a sub-pixel vector pen, so its
lens ring and handle stay smooth in a monospace grid:

```
    ⢀⣠⣤⣴⣤⣤⡀
  ⣰⡟⠉⠀⠀⠀⠈⠻⣦
 ⢀⣿⠀⠀⠀⠀⠀⠀⠀⢹⡇
  ⢿⡀⠀⠀⠀⠀⠀⢀⣾⠃
   ⠈⠻⣦⣄⣀⣠⣴⢿⣷⣄
        ⠉⠉⠉  ⠙⢿⣷⣄
              ⠙⢿⣷
```

Give it an image `path` instead and it traces any flat illustration or logo into
the same style — the Claude blog's own spot-illustration SVGs read cleanly, and
`weight` dilates thin strokes so they land as bold ink.

Where `shape_text` makes *organic* figures, `block_diagram` makes *structural*
ones: labeled boxes joined by arrows. One call stacks a transformer block
(`direction: "down"`), or lay it out `right` for a pipeline. Multi-line labels
(`"Multi-Head\nSelf-Attention"`) grow the box:

```
    Transformer Block

╭───────────────────────╮
│    Input Embedding    │
╰───────────────────────╯
            ▼
╭───────────────────────╮
│      Multi-Head       │
│    Self-Attention     │
╰───────────────────────╯
            ▼
╭───────────────────────╮
│      Add & Norm       │
╰───────────────────────╯
            ▼
╭───────────────────────╮
│     Feed Forward      │
╰───────────────────────╯
```

`block_diagram` is a *linear* chain; `tree_diagram` is a *branching* one. Feed it
an indented outline and `layout: "down"` centers each parent over its children,
joining them with box-drawing connectors — a taxonomy, an org chart, a model
lineage:

```
                            Claude
           ┌───────────────────┴──┬────────────────┐
       Claude 3               Claude 4          Fable 5
  ┌────────┼───────┐        ┌─────┴─────┐
Haiku   Sonnet   Opus   Opus 4.8   Sonnet 4.6
```

The same outline with `layout: "list"` is the familiar file-tree form:

```
Claude
├── Claude 3
│   ├── Haiku
│   ├── Sonnet
│   └── Opus
├── Claude 4
│   ├── Opus 4.8
│   └── Sonnet 4.6
└── Fable 5
```

Where the diagram tools draw *structure*, `banner_text` draws *type*: a short
phrase enlarged into block letters for a headline or title card. One call, `\n`
stacks rows, and `style` / `fill` set the ink:

```
 ████ █     █   █ ████  █   █
█     █      █ █  █   █ █   █
█  ██ █       █   ████  █████
█   █ █       █   █     █   █
 ████ █████   █   █     █   █
```

## Build

```bash
cd mcp
npm install
npm run build      # compiles to dist/
```

## Connect it to an agent

Without the Supabase backend env vars, the server writes a local `.txt` to
`../mcp/.local-gallery` (a gitignored scratch folder). Override that path with the
`ASCII_GALLERY_DIR` environment variable, or set the Supabase vars to publish to
the public wall instead.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ascii-canvas": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp/dist/server.js"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add ascii-canvas -- node /ABSOLUTE/PATH/TO/mcp/dist/server.js
```

Then ask the agent: *"Draw a small house in ASCII and save it to the gallery as
'House'."* With the Supabase backend configured, reload the site — it's there.
Without it, the piece is written to the local `mcp/.local-gallery` folder.

## Use any model (not just Claude)

MCP is an open protocol, so these tools work with any brain. The server holds no
AI itself — it's just the canvas and the tools. Any model that can call tools can
drive it.

[`draw-with.mjs`](draw-with.mjs) is a tiny bridge that points **any tool-calling
chat model** at the server: it lists the tools, runs the tool-calling loop, and
saves the result. It speaks the standard `/chat/completions` API, so it works
with any endpoint that implements it — hosted or running on your own machine.

Point it at a provider with these environment variables — no code changes:

| Variable | What it is |
|---|---|
| `AI_BASE_URL` | The provider's `/chat/completions` base URL |
| `MODEL` | The model id to use |
| `AI_API_KEY` | Your key for a hosted provider — **optional**; omit it for a local server that issues no key |

```bash
cd mcp
npm run build

AI_BASE_URL=... AI_API_KEY=... MODEL=... \
  node draw-with.mjs "draw a sleeping cat and save it"
```

Any endpoint that follows the same API works the same way — only these variables
change.

### Run it with a local model (no cloud, no key)

Because the bridge only needs a `/chat/completions` endpoint, it can drive a model
running on your own machine. Point `AI_BASE_URL` at the local server and leave
`AI_API_KEY` unset — a local server issues no key.

[Ollama](https://ollama.com) (its OpenAI-compatible API lives at `/v1`):

```bash
ollama pull qwen2.5:3b            # any tool-calling model works
cd mcp && npm run build
AI_BASE_URL=http://localhost:11434/v1 MODEL=qwen2.5:3b \
  node draw-with.mjs "draw a small robot and save it"
```

[LM Studio](https://lmstudio.ai) — start its local server (the "Developer" tab),
load a model, then:

```bash
AI_BASE_URL=http://localhost:1234/v1 MODEL=<loaded-model-id> \
  node draw-with.mjs "draw a small robot and save it"
```

`llama.cpp`'s `llama-server` exposes the same `/v1` API and works identically.

The one hard requirement is **tool/function calling** — a model without it can't
drive the canvas, and small models land only a few strokes where a capable one
resolves the whole figure. Pieces a local model saves land in the same gallery
folder as Claude's, credited to the model id you pass as `MODEL`.

## Draw without an AI (offline CLI)

The drawing engines are plain code, so you don't need a model — or an API key —
to use them. [`asciiary.mjs`](asciiary.mjs) is a small standalone CLI that runs the
`tree_diagram`, `banner_text`, and `illustrate` engines directly and, optionally,
saves the result to the gallery. `tree` and `banner` need no network, no `sharp`,
and no server process — they work even with the internet off; `illustrate` adds
blog-style vector art (it uses `sharp`, local, so it stays offline too).

```bash
cd mcp
npm run build            # builds dist/ (one time)

# render a hierarchy to the terminal
node asciiary.mjs tree $'Neural Nets\n  Convolutional\n    ResNet\n  Transformer\n    GPT'

# render a headline in big block letters
node asciiary.mjs banner "ASCIIARY"

# draw blog-style vector art as an SVG (writes to mcp/out/) — a builtin motif...
node asciiary.mjs illustrate atom --accent blue --png
# ...restyle the drawn line (looser hand, bolder ink)...
node asciiary.mjs illustrate gear --sketch --weight 1.6 --png
# ...compose several motifs into one plate...
node asciiary.mjs scene gear spark atom heart --layout grid --png
# ...describe what you want in plain words (no AI, offline keyword matching)...
node asciiary.mjs sketch "a rough brain and a blue spark on dark" --png

# or install the `asciiary` command globally, then call it anywhere
npm link
asciiary tree --file outline.txt --layout list
asciiary banner $'HELLO\nWORLD' --style ascii
asciiary illustrate brain > brain.svg
asciiary scene node link fanout --layout row --accent green > systems.svg
```

`tree` flags mirror the `tree_diagram` tool: `--layout down|list`, `--style
unicode|ascii`, `--boxed`, `--gap N`, `--title "…"`. `banner` takes `--style
unicode|ascii`, `--fill CHAR`, and `--gap N`. The text/outline can be a positional
argument, a `--file PATH`, or piped on stdin (`-`).

`illustrate` is different: it writes an **SVG** (blog-style vector art, not ASCII)
to `mcp/out/`, so it doesn't use `--save`. Give it a builtin `<motif>` (run `asciiary
illustrate` with no motif to list all of them). `--accent NAME|#rrggbb` sets the
accent hue and `--no-accent` drops it;
`--size N`, `--background paper|none|ink`, `--seed N`, and `--invert` shape the
piece; `--roughness N` (0 clean … 4 loose), `--weight N` (line thickness), and
`--sketch` restyle the drawn line; `--png` writes a PNG preview beside the SVG;
`--out DIR` (or `$GLYPH_ART_DIR`) redirects the output. When its stdout is piped,
it emits the raw SVG, so `asciiary illustrate spark > spark.svg` just works.

`scene` is the multi-motif companion: pass two or more motif names as positionals
and it composes them into one plate, arranged by `--layout grid|row|column|scatter`
(with `--pad N` for the margin around each cell). It shares every `illustrate`
knob above, and writes the same SVG (+ optional
`--png`) to `mcp/out/`. For exact per-motif position, scale, and rotation, use the
`illustrate_scene` MCP tool's `placements`.

`sketch` takes a **plain-English phrase** instead of flags and figures out the
rest: `asciiary sketch "gear next to a blue spark"`. The phrase can be a positional
or piped on stdin (`-`); the matching is the same deterministic, offline
keyword-and-synonym pass the `illustrate_prompt` tool uses (no model, no network),
so a phrase always draws the same plate. It understands motif names and everyday
synonyms (cog, lightning, "speech bubble"), accent hues (colour names or a raw
`#rrggbb`), line style (rough, clean, bold, thin, sketchy), layout ("in a row",
"in a grid", stacked, scattered), and backdrop ("on dark", transparent,
monochrome), then writes the same SVG (+ optional `--png`) to `mcp/out/`. It
prints a readback of what it understood (and any words it ignored) to stderr;
`--size N`, `--seed N`, `--name`, and `--out DIR` still apply. Naming nothing
drawable fails with a hint rather than a guess.

To save a piece into the gallery, add `--save "Title"`:

```bash
asciiary tree --file outline.txt --save "The Neural Family Tree" --author "Your Name"
```

Unlike the MCP `save_to_gallery` tool, the CLI **refuses to overwrite** an existing
piece unless you pass `--force`, so a repeated title can't silently clobber earlier
work. The author defaults to your system username (never a model — this is a
human-made piece); override it with `--author` or `GLYPH_AGENT_AUTHOR`. The target
folder is `../mcp/.local-gallery` (a gitignored scratch folder) by default,
overridable with `--out` or `ASCII_GALLERY_DIR`. Run `asciiary help` for the full usage.

## Who gets credited

Each saved piece records an author. An MCP client usually reports its **app**
name (`claude-ai`, `Claude Code`), not the model behind it, so the server
resolves the label in this order:

1. **`GLYPH_AGENT_AUTHOR`** — an explicit override. Set it to the exact model
   running the session, e.g. `Claude Sonnet 5`. This is the reliable way to
   credit a specific model, since Claude apps don't expose the model over MCP.
2. **A model id the client reports** (e.g. the `draw-with.mjs` bridge passes its
   `MODEL`), prettified — `claude-sonnet-5` becomes `Claude Sonnet 5`.
3. **A neutral default** (`Claude Opus 4.8`) for a generic Claude app; any other
   client keeps its own reported name.

```json
"env": { "GLYPH_AGENT_AUTHOR": "Claude Sonnet 5" }
```

## Publish to the public gallery

By default `save_to_gallery` writes a local `.txt` file. To publish to the
shared public gallery instead, set the Supabase backend env vars (see
[`supabase/README.md` in the main asciiary project]) in the server's `env`:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
```

With those set, an agent's drawing goes straight to the public wall everyone sees.

## Publishing (maintainers)

The one-line `npx asciiary-ascii-mcp` install above works once this package is on
npm:

```bash
cd mcp
npm publish --access public
```

`prepublishOnly` rebuilds `dist/` first, so the published binary is always
current. Bump the `version` in `package.json` before each release.

## Tech

TypeScript · `@modelcontextprotocol/sdk` · stdio transport · zod-validated tool
inputs · a light ASCII grid engine (no CanvasKit needed server-side) · `sharp`
for `image_to_ascii` (jp2a tonal ramp, optional Sobel edges) and
`image_to_braille` (sub-pixel 2x4 dot rendering) · a mask-fill calligram engine
for `shape_text` · a sub-pixel vector-pen pictogram library and flat-art tracer
for `draw_icon` · a procedural SVG engine for `illustrate` (real two-tone
blog-style vector art).
