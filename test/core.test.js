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

test("background delegation exposes tracked status after completion", async () => {
  let resolveRun;
  const bridge = new ClaudeBridge({
    claudeBin: "/usr/local/bin/claude",
    run: () => new Promise((resolve) => { resolveRun = resolve; }),
  });

  const job = bridge.delegateBackground({ task: "Implement feature X", workDir: "/tmp/project" });
  assert.deepEqual(bridge.status(job.jobId), { jobId: job.jobId, state: "running" });

  resolveRun({
    code: 0,
    stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "session-background", result: "complete" }),
    stderr: "",
  });
  await job.done;

  assert.deepEqual(bridge.status(job.jobId), {
    jobId: job.jobId,
    state: "completed",
    sessionId: "session-background",
    result: "complete",
  });
});

test("cancelling a background job signals the running Claude process", async () => {
  let signal;
  const bridge = new ClaudeBridge({
    claudeBin: "/usr/local/bin/claude",
    run: (command, args, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  const job = bridge.delegateBackground({ task: "Implement feature X", workDir: "/tmp/project" });

  bridge.cancel(job.jobId);

  assert.equal(signal.aborted, true);
  assert.deepEqual(bridge.status(job.jobId), { jobId: job.jobId, state: "cancelled" });
});

const { runProcess } = await import("../src/runner.js");

test("runner captures a subprocess exit code and output", async () => {
  const completed = await runProcess(
    process.execPath,
    ["-e", "console.log('hello'); console.error('warning')"],
    {},
  );

  assert.equal(completed.code, 0);
  assert.equal(completed.stdout, "hello\n");
  assert.equal(completed.stderr, "warning\n");
});

test("authentication errors give an actionable Claude Code login instruction", async () => {
  const bridge = new ClaudeBridge({
    run: async () => ({
      code: 1,
      stdout: JSON.stringify({ is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" }),
      stderr: "",
    }),
  });

  await assert.rejects(
    () => bridge.delegate({ task: "Implement feature X", workDir: "/tmp/project" }),
    /Claude Code authentication failed\. Run `claude auth login` in a terminal, then retry\./,
  );
});
