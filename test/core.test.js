import assert from "node:assert/strict";
import test from "node:test";

import { ClaudeBridge } from "../src/core.js";

test("delegate captures Claude session ID for exact later continuation", async () => {
  const run = async (command, args, options) => {
    assert.equal(command, "/usr/local/bin/claude");
    assert.equal(options.cwd, "/tmp/project");
    return {
      code: 0,
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "session-123",
        result: "done",
      }),
      stderr: "",
    };
  };
  const bridge = new ClaudeBridge({ claudeBin: "/usr/local/bin/claude", run });

  const outcome = await bridge.delegate({ task: "Implement feature X", workDir: "/tmp/project" });

  assert.equal(outcome.sessionId, "session-123");
  assert.equal(outcome.result, "done");
  assert.deepEqual(outcome.args, [
    "-p", "--output-format", "json", "--max-turns", "10", "Implement feature X",
  ]);
});

test("continue resumes the exact stored session rather than directory latest", async () => {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    return {
      code: 0,
      stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "session-123", result: "fixed" }),
      stderr: "",
    };
  };
  const bridge = new ClaudeBridge({ claudeBin: "/usr/local/bin/claude", run });
  await bridge.delegate({ task: "Implement feature X", workDir: "/tmp/project" });

  const outcome = await bridge.continue({ sessionId: "session-123", prompt: "Fix the failing test" });

  assert.equal(outcome.result, "fixed");
  assert.deepEqual(calls[1].args, [
    "-p", "--output-format", "json", "--max-turns", "10", "--resume", "session-123", "Fix the failing test",
  ]);
});

test("review is constrained to read and git diff commands", async () => {
  const calls = [];
  const bridge = new ClaudeBridge({
    claudeBin: "/usr/local/bin/claude",
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        code: 0,
        stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "review-1", result: "no issues" }),
        stderr: "",
      };
    },
  });

  await bridge.review({ workDir: "/tmp/project", scope: "current changes" });

  assert.deepEqual(calls[0].args, [
    "-p", "--output-format", "json", "--max-turns", "5",
    "--allowedTools", "Read,Bash(git diff *),Bash(git status *)",
    "Review current changes for bugs, security issues, regressions, and missing tests. Scope: current changes. Do not edit files or run state-changing commands.",
  ]);
});
