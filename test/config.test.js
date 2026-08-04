import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { stateFilePath } from "../src/config.js";

test("prefers Claude for Agents state configuration while accepting the legacy alias", () => {
  assert.equal(
    stateFilePath({
      CLAUDE_FOR_AGENTS_STATE: "/new/state.json",
      CLAUDE_FOR_HERMES_STATE: "/legacy/state.json",
    }, "/home/test", () => false),
    "/new/state.json",
  );
  assert.equal(
    stateFilePath({ CLAUDE_FOR_HERMES_STATE: "/legacy/state.json" }, "/home/test", () => false),
    "/legacy/state.json",
  );
});

test("uses the new default state path and reuses an existing legacy state file", () => {
  const current = join("/home/test", ".claude-for-agents", "state.json");
  const legacy = join("/home/test", ".claude-for-hermes", "state.json");

  assert.equal(stateFilePath({}, "/home/test", () => false), current);
  assert.equal(stateFilePath({}, "/home/test", (path) => path === legacy), legacy);
  assert.equal(stateFilePath({}, "/home/test", () => true), current);
});
