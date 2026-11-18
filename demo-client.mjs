// Demo: drive the ascii-canvas MCP server exactly like an AI client would.
// Connects over stdio, lists the tools, draws a small robot with the drawing
// tools, renders it (the "see-and-correct" step), then publishes it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["dist/server.js"],
});
const client = new Client({ name: "ascii-demo", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("Tools exposed by the server:");
console.log("  " + tools.map((t) => t.name).join(", ") + "\n");

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args });
  return res.content?.[0]?.text ?? "";
};

// A sequence of tool calls, the same kind an agent would issue.
await call("new_canvas", { width: 18, height: 9 });
await call("draw_rect", { x: 2, y: 0, width: 13, height: 5, char: "#" });
await call("draw_text", { x: 5, y: 2, text: "o    o" });
await call("draw_text", { x: 6, y: 3, text: "____" });
await call("set_char", { x: 6, y: 5, char: "|" });
await call("set_char", { x: 11, y: 5, char: "|" });
await call("draw_rect", { x: 3, y: 6, width: 11, height: 3, char: "=" });
await call("draw_text", { x: 5, y: 7, text: "ASCII" });

console.log("render() -> what the agent sees:\n");
console.log(await call("render"));

console.log("\nsave_to_gallery():");
console.log("  " + (await call("save_to_gallery", { title: "MCP Bot" })));

await client.close();
