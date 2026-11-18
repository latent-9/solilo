// Resolve a human-facing author label for an agent-drawn piece.
// An MCP client usually reports an app name ("Claude Code", "claude-ai"), not
// the model it is running. So attribution is resolved in priority order:
//   1) an explicit GLYPH_AGENT_AUTHOR override — set it to the exact model,
//      e.g. "Claude Sonnet 5"; this is the reliable way to credit a non-default
//      model, since Claude apps do not expose the model over MCP;
//   2) a model id the client itself reports (e.g. a draw-with bridge), which is
//      prettified into a readable label;
//   3) a neutral default for a generic Claude app, otherwise the reported name.

// Used when the client is a Claude app that only reports its app name, so the
// running model is unknown. Overridable per run via GLYPH_AGENT_AUTHOR.
export const DEFAULT_AGENT_AUTHOR = "Claude Opus 4.8";

// "claude-sonnet-5" -> "Claude Sonnet 5"; "claude-opus-4-8" -> "Claude Opus 4.8";
// "claude-haiku-4-5-20251001" -> "Claude Haiku 4.5". Returns null when the
// string is not a recognizable Claude model id (e.g. an app name like
// "claude-ai" or a non-Claude client).
export function prettyModel(name: string): string | null {
  const m = name
    .toLowerCase()
    .match(/^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[.-](\d+))?/);
  if (!m) return null;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `Claude ${family} ${version}`;
}

// Resolve the label. `override` is GLYPH_AGENT_AUTHOR; `fallback` is the label
// for a generic Claude app whose model we cannot detect.
export function resolveAuthor(
  clientName: string,
  override?: string,
  fallback: string = DEFAULT_AGENT_AUTHOR,
): string {
  const o = override?.trim();
  if (o) return o;
  const pretty = prettyModel(clientName);
  if (pretty) return pretty;
  // A generic Claude app name maps to the fallback; any other client keeps its
  // own reported name (the bridge reports the exact model it was configured with).
  return /^claude/i.test(clientName) ? fallback : clientName;
}
