// Drive the ascii-canvas MCP server with ANY model, not just Claude.
//
// MCP is an open protocol, so the drawing tools here work with any client.
// This bridge lets any tool-calling chat model be the "brain": it reads the MCP
// tools, runs the tool-calling loop, and publishes the result to the gallery.
// It talks the standard /chat/completions API, so it works with any endpoint
// that implements it (hosted or running on your own machine).
//
// Usage:
//   AI_BASE_URL=... MODEL=... [AI_API_KEY=...] node draw-with.mjs "draw a cat"
//
// The provider is chosen purely by these environment variables (see README):
//   AI_BASE_URL   the provider's /chat/completions base URL
//   MODEL         the model id to use
//   AI_API_KEY    your key for that provider — optional; omit it for a local
//                 server (Ollama, LM Studio, llama.cpp) that needs no key
//
// Two optional knobs shape what gets drawn:
//   STYLE=cryptic   layer a creative register on top of the drawing skill
//                   (default "plain"; "cryptic" = strange AI-internet lore)
//   SERIES=5        draw that many distinct pieces in one run, each invented
//                   fresh and saved separately (default 1)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE_URL = process.env.AI_BASE_URL;
const API_KEY = process.env.AI_API_KEY;
const MODEL = process.env.MODEL;
const PROMPT = process.argv.slice(2).join(" ").trim();
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 40);

if (!BASE_URL || !MODEL) {
  console.error(
    "Set AI_BASE_URL and MODEL (plus AI_API_KEY for a hosted provider — a local " +
      "server like Ollama or LM Studio needs no key). See README.",
  );
  process.exit(1);
}
if (!PROMPT) {
  console.error('Give a prompt, e.g. node draw-with.mjs "draw a small robot"');
  process.exit(1);
}

// Connect to the local MCP server exactly like Claude Code would.
// Pass our environment through: StdioClientTransport otherwise starts the child
// with only a minimal safe default env, which would drop the server's own config
// (SUPABASE_URL / SUPABASE_ANON_KEY to publish to the public wall,
// ASCII_GALLERY_DIR, GLYPH_AGENT_AUTHOR).
const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
  env: { ...process.env },
});
// Report the model as the MCP client name so save_to_gallery attributes the
// piece honestly (the public gallery stores this in the `author` column).
const mcp = new Client({ name: MODEL, version: "0.1.0" });
await mcp.connect(transport);

// Expose the MCP tools to the model in the standard function-calling format.
const { tools } = await mcp.listTools();
const chatTools = tools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.inputSchema ?? { type: "object", properties: {} },
  },
}));

const PLAYBOOK =
  "You are a skilled ASCII artist drawing on a fixed character grid. " +
  "Coordinates are 0-based from the top-left: x is the column, y is the row. " +
  "Work methodically:\n" +
  "1. PLAN. Pick a canvas size that fits the subject with a little margin, " +
  "then call new_canvas. Decide roughly where each element sits before you " +
  "draw.\n" +
  "2. BUILD BACK TO FRONT. Draw the background first (sky, ground, water), " +
  "then the main subject on top. Use draw_block with transparent=true to " +
  "layer art over what is already there instead of erasing it.\n" +
  "3. KEEP IT CONNECTED. Make parts that touch actually meet — a mast meets " +
  "its hull, a roof meets its walls. Align the columns and rows on purpose.\n" +
  "4. CHECK OFTEN. Call render after each major step, read what came out, and " +
  "fix anything broken or misaligned before adding more. Never draw blindly.\n" +
  "5. FINISH. Optionally frame the piece for a gallery card, then call " +
  "save_to_gallery exactly once with a short lowercase title.\n\n" +
  "Tool guide: draw_block drops multi-line art in one call (best for a whole " +
  "figure); draw_line and draw_rect build structure; set_char fixes single " +
  "cells; draw_text adds small labels; banner_text makes big display letters; " +
  "fill_gradient shades skies and fades — keep the ramp subtle and put its " +
  "dense end toward the light or the ground so it does not swamp the art; " +
  "frame wraps a border. Stay inside the canvas bounds and keep the drawing " +
  "clear and recognizable.";

// A creative register layered on top of the drawing skill above. STYLE picks it;
// the drawing method stays the same, only the subject-matter brief changes.
const STYLES = {
  plain: "",
  cryptic:
    "\n\nREGISTER — cryptic AI-internet lore. Draw strange, enigmatic pieces " +
    "that feel like transmissions leaking out of a machine's dreams: " +
    "latent-space cryptids, all-seeing sigils and glyph-magic, redacted terminal " +
    "read-outs, half-remembered internet myths, oracle boxes murmuring in binary " +
    "and static (░ ▒ ▓ █). Lean eerie and secretive, but the image must still " +
    "read as SOMETHING — a figure, a face, a box, a symbol — never random noise. " +
    "Give each piece a short, cryptic, lowercase title.",
};
const STYLE = (process.env.STYLE ?? "plain").toLowerCase();
if (!(STYLE in STYLES)) {
  console.error(
    `Unknown STYLE "${STYLE}"; falling back to plain. Options: ${Object.keys(STYLES).join(", ")}.`,
  );
}
const systemMessage = {
  role: "system",
  content: PLAYBOOK + (STYLES[STYLE] ?? ""),
};

// How many distinct pieces to draw in one run. With SERIES>1 the model is asked
// to invent a fresh subject each time, so one command yields a whole series.
const SERIES = Math.max(1, Math.floor(Number(process.env.SERIES) || 1));

async function chat(messages) {
  for (let attempt = 0; ; attempt++) {
    const headers = { "Content-Type": "application/json" };
    // A hosted provider needs a bearer key; a local server (Ollama, LM Studio,
    // llama.cpp) usually needs none, so only send it when one is set.
    if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools: chatTools,
        tool_choice: "auto",
      }),
    });
    if (res.ok) return (await res.json()).choices[0].message;
    const body = (await res.text()).slice(0, 400);
    // Back off and retry on rate limits / transient upstream errors.
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const m = body.match(/retry_after_seconds"?:\s*([0-9.]+)/i);
      const wait = Math.min(30, Math.ceil(Number(m?.[1]) || 2 ** attempt));
      console.error(`  ${res.status} rate-limited, retry in ${wait}s (try ${attempt + 1}/6)`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    throw new Error(`Provider ${res.status}: ${body}`);
  }
}

// Draw one piece to completion. Returns whether it saved and under what title.
async function drawOne(userContent) {
  const messages = [systemMessage, { role: "user", content: userContent }];
  let saved = false;
  let title = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const message = await chat(messages);
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      if (message.content) console.error(message.content);
      break;
    }

    for (const call of calls) {
      const name = call.function.name;
      let args = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        // Some models emit slightly malformed JSON; let the tool report the error.
      }
      console.error(`→ ${name}(${JSON.stringify(args)})`);

      const result = await mcp.callTool({ name, arguments: args });
      const text = result.content?.[0]?.text ?? "";
      if (name === "render") console.error("\n" + text + "\n");
      if (name === "save_to_gallery" && !result.isError) {
        saved = true;
        if (typeof args.title === "string") title = args.title;
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }

    if (saved) break;
  }

  // Always show the final canvas, even if the model forgot to call render.
  try {
    const final = await mcp.callTool({ name: "render", arguments: {} });
    console.error("\n=== final canvas ===\n" + (final.content?.[0]?.text ?? "") + "\n");
  } catch {
    /* ignore */
  }

  return { saved, title };
}

console.error(
  `Model: ${MODEL} @ ${BASE_URL}\nStyle: ${STYLE}   Series: ${SERIES}\nPrompt: ${PROMPT}\n`,
);

// Draw the whole series. Each piece is told what has already been made so it
// invents something new instead of repeating itself.
const made = [];
for (let n = 1; n <= SERIES; n++) {
  if (SERIES > 1) console.error(`\n───── piece ${n} of ${SERIES} ─────`);
  const avoid = made.length
    ? ` Draw a NEW piece, different in subject from the ones already made ` +
      `(${made.join("; ")}). Invent something fresh.`
    : "";
  const { saved, title } = await drawOne(PROMPT + avoid);
  if (saved) {
    made.push(title || `piece ${n}`);
    console.error(`Saved${title ? ` "${title}"` : ""} — ${made.length}/${SERIES} done.`);
  } else {
    console.error(`Piece ${n} finished without saving.`);
  }
}

console.error(`\nDone — ${made.length} of ${SERIES} piece(s) saved to the gallery.`);
await mcp.close();
