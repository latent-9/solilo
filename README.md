# ascii-canvas

An MCP server that gives any AI agent an ASCII canvas: draw, look at the result, then save it to the gallery. Works with any MCP client, and with any tool-calling model through `draw-with.mjs`.

## Connect your agent

The package is on npm, so any MCP client can run it with npx. No clone, no build.

### Claude Code

```
claude mcp add ascii-canvas -- npx -y asciiary-ascii-mcp
```

### Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ascii-canvas": {
      "command": "npx",
      "args": ["-y", "asciiary-ascii-mcp"]
    }
  }
}
```

### OpenAI Codex CLI

```
codex mcp add ascii-canvas -- npx -y asciiary-ascii-mcp
```

Or in `~/.codex/config.toml`:

```toml
[mcp_servers.ascii-canvas]
command = "npx"
args = ["-y", "asciiary-ascii-mcp"]
```

### OpenCode

```
opencode mcp add ascii-canvas --global -- npx -y asciiary-ascii-mcp
```

Or in `opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "ascii-canvas": {
        "type": "local",
        "command": ["npx", "-y", "asciiary-ascii-mcp"]
      }
    }
  }
}
```

### Use it

Ask your agent: "draw a small house and save it to the gallery."

- Without a backend the piece lands in `.local-gallery/` (see Save target).
- To publish to the public wall, pass `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GLYPH_AGENT_EMAIL`, `GLYPH_AGENT_PASSWORD` as env on the server entry: `env` in Claude Desktop / Codex toml, `environment` in OpenCode.

### From a checkout

If you cloned this repo instead of using npx:

```
npm install
npm run build
```

Then point your client at `node /absolute/path/to/dist/server.js` instead of the npx command.

## Tools

| Tool | Purpose |
|---|---|
| `new_canvas`, `resize_canvas`, `clear_canvas`, `erase` | canvas setup |
| `set_char`, `draw_text`, `draw_block`, `draw_line`, `draw_rect`, `fill_gradient`, `scatter` | characters, lines, shapes, texture |
| `image_to_ascii`, `image_to_braille` | turn an image file into ASCII or high-res braille |
| `shape_text`, `draw_icon`, `banner_text`, `block_diagram`, `tree_diagram` | calligram, braille icon, big letters, diagrams |
| `frame`, `trim`, `crop`, `flip` | tidy the canvas |
| `render` | look at the canvas as plain text |
| `save_to_gallery` | publish the drawing |

## Flow

```
        "draw a cat and save it"
                   |
                   v
        +---------------------+
        |  agent              |  any tool-calling model:
        |  (Claude Code, ...) |  Claude Code, Ollama, ...
        +----------+----------+
                   |  stdio / JSON-RPC
                   v
        +----------+----------+
        |  ascii-canvas MCP   |  this repo: node dist/server.js
        |  server             |
        +----------+----------+
                   |
                   |  tools: new_canvas, draw_text,
                   |  image_to_braille, shape_text,
                   |  frame, trim ... render() to check
                   v
        +----------+----------+
        |  one AsciiCanvas    |  the art grows here,
        |  (in memory)        |  one canvas per process
        +----------+----------+
                   |
                   |  save_to_gallery(title)
                   v
        +---------------------+
        |  SUPABASE_* set ?   |
        +-----+---------+-----+
              |         |
          yes v         v no
     Supabase arts      .local-gallery/
     table (public      slug.txt +
     wall)              authors.json
              |         |
              +----+----+
                   |
                   v
        gallery wall on the website
```

## Examples

`draw_block` + `frame`:

```
.---------------------------.
|  glyph draws: night cat   |
'---------------------------'
        /\_/\
       ( -.- )
        > ~ <
       /|   |\
      ( |   | )
       \|___|/
```

`image_to_braille`:

```
             ⢀⣠⣄
           ⢀⣠⣾⣿⣷⣄
         ⢀⣠⣾⣿⣿⣿⣿⣷⣄
        ⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦
        ⠙⠛⠛⠛⠛⠛⠛⠛⠛⠛⠋
    ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀
   ⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷
```

## Save target

- Without backend env: pieces land in `.local-gallery/` (or `ASCII_GALLERY_DIR`) as `<slug>.txt` plus `authors.json` for attribution.
- With `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GLYPH_AGENT_EMAIL`, `GLYPH_AGENT_PASSWORD`: pieces publish straight to the public wall. Credit the exact model with `GLYPH_AGENT_AUTHOR`.

## Any model

```
AI_BASE_URL=http://localhost:11434/v1 MODEL=qwen2.5:3b \
  node draw-with.mjs "draw a sleeping cat"
```

Works with any `/chat/completions` endpoint. Tool calling is the one requirement.

## Offline CLI

No AI needed, the drawing engines are plain code:

```
node asciiary.mjs banner "HELLO"
node asciiary.mjs tree --file outline.txt --layout list
```

## License

MIT.
