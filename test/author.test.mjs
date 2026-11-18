// Tests for author attribution resolution (which model gets credited).
import { test } from "node:test";
import assert from "node:assert/strict";
import { prettyModel, resolveAuthor, DEFAULT_AGENT_AUTHOR } from "../dist/author.js";

test("prettyModel turns a model id into a readable label", () => {
  assert.equal(prettyModel("claude-opus-4-8"), "Claude Opus 4.8");
  assert.equal(prettyModel("claude-sonnet-5"), "Claude Sonnet 5");
  assert.equal(prettyModel("claude-haiku-4-5-20251001"), "Claude Haiku 4.5");
  assert.equal(prettyModel("claude-fable-5"), "Claude Fable 5");
});

test("prettyModel returns null for app names and non-Claude clients", () => {
  assert.equal(prettyModel("claude-ai"), null);
  assert.equal(prettyModel("Claude Code"), null);
  assert.equal(prettyModel("Cursor"), null);
});

test("resolveAuthor: an explicit override always wins", () => {
  assert.equal(
    resolveAuthor("claude-ai", "Claude Sonnet 5"),
    "Claude Sonnet 5",
  );
  assert.equal(resolveAuthor("Cursor", "  Someone  "), "Someone");
});

test("resolveAuthor: a reported model id is prettified", () => {
  assert.equal(resolveAuthor("claude-sonnet-5"), "Claude Sonnet 5");
});

test("resolveAuthor: a generic Claude app falls back to the default", () => {
  assert.equal(resolveAuthor("claude-ai"), DEFAULT_AGENT_AUTHOR);
  assert.equal(resolveAuthor("Claude Code"), DEFAULT_AGENT_AUTHOR);
});

test("resolveAuthor: a non-Claude client keeps its own name", () => {
  assert.equal(resolveAuthor("Cursor"), "Cursor");
});
