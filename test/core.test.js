import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ClaudeBridge } from "../src/core.js";
import { FileStateStore } from "../src/state.js";

test("file state store persists JSON atomically with owner-only permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "claude-for-agents-state-"));
  const path = join(directory, "state.json");
  try {
    const store = new FileStateStore(path);
    assert.deepEqual(store.load(), {});
    store.save({ sessions: [["session-1", { policy: "review" }]], nextJobId: 2 });
    assert.deepEqual(store.load(), { sessions: [["session-1", { policy: "review" }]], nextJobId: 2 });
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.doesNotThrow(() => JSON.parse(readFileSync(path, "utf8")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delegate captures Claude session ID for exact later continuation", async () => {
  const run = async (command, args, options) => {
    assert.equal(command, "/usr/local/bin/claude");
    assert.equal(options.cwd, "/tmp/project");
    assert.equal(options.input, "Implement feature X");
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
    "-p", "--output-format", "json", "--allowedTools", "Read,Edit,Write,Bash(npm test),Bash(npm test *),Bash(node --check *),Bash(git diff *),Bash(git status *)",
  ]);
});

test("delegate preserves Claude result telemetry from newline-delimited output", async () => {
  const bridge = new ClaudeBridge({
    run: async () => ({
      code: 0,
      stderr: "",
      stdout: [
        JSON.stringify({ type: "assistant", message: { content: "working" } }),
        JSON.stringify({ type: "result", subtype: "success", session_id: "session-telemetry", result: "done", duration_ms: 42, num_turns: 2, cost_usd: 0.01 }),
      ].join("\n"),
    }),
  });

  const outcome = await bridge.delegate({ task: "Inspect", workDir: "/tmp/project" });

  assert.equal(outcome.sessionId, "session-telemetry");
  assert.equal(outcome.telemetry.exitCode, 0);
  assert.equal(outcome.telemetry.events.length, 2);
  assert.equal(outcome.telemetry.result.duration_ms, 42);
  assert.equal(outcome.telemetry.result.num_turns, 2);
  assert.equal(outcome.telemetry.result.cost_usd, 0.01);
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
  assert.equal(calls[1].options.input, "Fix the failing test");
  assert.deepEqual(calls[1].args, [
    "-p", "--output-format", "json", "--allowedTools", "Read,Edit,Write,Bash(npm test),Bash(npm test *),Bash(node --check *),Bash(git diff *),Bash(git status *)", "--resume", "session-123",
  ]);
});

test("continuing a readonly session retains its immutable review policy", async () => {
  const calls = [];
  const bridge = new ClaudeBridge({
    claudeBin: "/usr/local/bin/claude",
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        code: 0,
        stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "readonly-1", result: "reviewed" }),
        stderr: "",
      };
    },
  });

  await bridge.delegate({ task: "Inspect the project", workDir: "/tmp/project", readonly: true });
  await bridge.continue({ sessionId: "readonly-1", prompt: "Check one more file", policy: "code" });

  assert.equal(calls[1].options.input, "IMPORTANT: This is a READ-ONLY task. Do not edit files or run state-changing commands.\n\nCheck one more file");
  assert.deepEqual(calls[1].args, [
    "-p", "--output-format", "json", "--allowedTools", "Read,Bash(git diff *),Bash(git status *),Bash(npm test),Bash(npm test *),Bash(node --check *)", "--resume", "readonly-1",
  ]);
});

test("continue can switch the model while retaining the exact session", async () => {
  const calls = [];
  const bridge = new ClaudeBridge({
    claudeBin: "/usr/local/bin/claude",
    run: async (command, args) => {
      calls.push({ command, args });
      return {
        code: 0,
        stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "session-123", result: "switched" }),
        stderr: "",
      };
    },
  });
  await bridge.delegate({ task: "Implement feature X", workDir: "/tmp/project" });

  await bridge.continue({ sessionId: "session-123", prompt: "Use Haiku now", model: "haiku" });

  assert.deepEqual(calls[1].args, [
    "-p", "--output-format", "json", "--model", "haiku",
    "--allowedTools", "Read,Edit,Write,Bash(npm test),Bash(npm test *),Bash(node --check *),Bash(git diff *),Bash(git status *)", "--resume", "session-123",
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

  assert.equal(calls[0].options.input, "IMPORTANT: This is a READ-ONLY task. Do not edit files or run state-changing commands.\n\nReview current changes for bugs, security issues, regressions, and missing tests. Scope: current changes. Run only allowed read-only checks if useful. Do not edit files or run state-changing commands.");
  assert.deepEqual(calls[0].args, [
    "-p", "--output-format", "json",
    "--allowedTools", "Read,Bash(git diff *),Bash(git status *),Bash(npm test),Bash(npm test *),Bash(node --check *)",
  ]);
});

test("review accepts an explicit model and turn budget", async () => {
  const calls = [];
  const bridge = new ClaudeBridge({
    run: async (command, args) => {
      calls.push(args);
      return {
        code: 0,
        stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "review-configured", result: "done" }),
        stderr: "",
      };
    },
  });

  await bridge.review({ workDir: "/tmp/project", model: "claude-opus-5", maxTurns: 20 });

  assert.deepEqual(calls[0].slice(0, 7), [
    "-p", "--output-format", "json", "--max-turns", "20", "--model", "claude-opus-5",
  ]);
});

test("review rejects an empty model before starting Claude", async () => {
  let invoked = false;
  const bridge = new ClaudeBridge({ run: async () => { invoked = true; } });

  await assert.rejects(
    () => bridge.review({ workDir: "/tmp/project", model: "   " }),
    /model must be a non-empty string/,
  );
  assert.equal(invoked, false);
});

test("review rejects an invalid turn budget before starting Claude", async () => {
  let invoked = false;
  const bridge = new ClaudeBridge({ run: async () => { invoked = true; } });

  await assert.rejects(
    () => bridge.review({ workDir: "/tmp/project", maxTurns: 100 }),
    /maxTurns must be an integer between 1 and 99/,
  );
  assert.equal(invoked, false);
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

  const status = bridge.status(job.jobId);
  assert.equal(status.jobId, job.jobId);
  assert.equal(status.state, "completed");
  assert.equal(status.sessionId, "session-background");
  assert.equal(status.result, "complete");
  assert.equal(status.telemetry.exitCode, 0);
  assert.equal(status.telemetry.result.session_id, "session-background");
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

test("runner writes supplied input to stdin and closes it", async () => {
  const completed = await runProcess(
    process.execPath,
    ["-e", "let input=''; process.stdin.on('data', (chunk) => input += chunk); process.stdin.on('end', () => console.log(input));"],
    { input: "prompt over stdin" },
  );

  assert.equal(completed.code, 0);
  assert.equal(completed.stdout, "prompt over stdin\n");
});

test("runner cancellation terminates the entire subprocess group", async () => {
  const directory = mkdtempSync(join(tmpdir(), "claude-for-agents-cancel-"));
  const marker = join(directory, "grandchild-survived");
  const grandchild = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "alive"), 300)`;
  const parent = [
    "const { spawn } = require('node:child_process');",
    `spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: "ignore" });`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const controller = new AbortController();

  try {
    const completion = runProcess(process.execPath, ["-e", parent], {
      signal: controller.signal,
      killGraceMs: 50,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const completed = await completion;
    await new Promise((resolve) => setTimeout(resolve, 400));

    assert.equal(completed.signal, "SIGTERM");
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("readonly delegation constrains Claude to inspection tools", async () => {
  const calls = [];
  const bridge = new ClaudeBridge({
    claudeBin: "/usr/local/bin/claude",
    run: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        code: 0,
        stdout: JSON.stringify({ type: "result", subtype: "success", session_id: "readonly-1", result: "findings" }),
        stderr: "",
      };
    },
  });

  await bridge.delegate({ task: "Inspect the project", workDir: "/tmp/project", readonly: true });

  assert.equal(calls[0].options.input, "IMPORTANT: This is a READ-ONLY task. Do not edit files or run state-changing commands.\n\nInspect the project");
  assert.deepEqual(calls[0].args, [
    "-p", "--output-format", "json",
    "--allowedTools", "Read,Bash(git diff *),Bash(git status *),Bash(npm test),Bash(npm test *),Bash(node --check *)",
  ]);
});

test("status lists every background job when no job ID is provided", () => {
  const bridge = new ClaudeBridge({ claudeBin: "/usr/local/bin/claude", run: () => new Promise(() => {}) });
  const job = bridge.delegateBackground({ task: "Implement feature X", workDir: "/tmp/project" });

  assert.deepEqual(bridge.status(), [{ jobId: job.jobId, state: "running" }]);
});

test("authentication errors explain the macOS background-login issue and token workaround", async () => {
  const bridge = new ClaudeBridge({
    run: async () => ({
      code: 1,
      stdout: JSON.stringify({ is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" }),
      stderr: "",
    }),
  });

  await assert.rejects(
    () => bridge.delegate({ task: "Implement feature X", workDir: "/tmp/project" }),
    /Claude Code authentication failed\. On macOS, background or launchd hosts may not see your Terminal Keychain login\. Run `claude setup-token`, set `CLAUDE_CODE_OAUTH_TOKEN` in the MCP server environment, restart the host, and retry\./,
  );
});

test("max-turn failures retain the exact Claude session for continuation", async () => {
  const calls = [];
  const bridge = new ClaudeBridge({
    run: async (command, args) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          code: 1,
          stdout: JSON.stringify({
            subtype: "error_max_turns",
            session_id: "session-max-turns",
            result: "Reached maximum number of turns",
          }),
          stderr: "",
        };
      }
      return {
        code: 0,
        stdout: JSON.stringify({
          subtype: "success",
          session_id: "session-max-turns",
          result: "continued",
        }),
        stderr: "",
      };
    },
  });

  await assert.rejects(
    () => bridge.delegate({ task: "Large task", workDir: "/tmp/project", maxTurns: 99 }),
    /Reached maximum number of turns/,
  );
  const outcome = await bridge.continue({
    sessionId: "session-max-turns",
    prompt: "Continue the same task",
    maxTurns: 99,
  });

  assert.equal(outcome.result, "continued");
  assert.equal(calls[1][calls[1].length - 1], "session-max-turns");
  assert.deepEqual(calls[1], [
    "-p", "--output-format", "json", "--max-turns", "99",
    "--allowedTools", "Read,Edit,Write,Bash(npm test),Bash(npm test *),Bash(node --check *),Bash(git diff *),Bash(git status *)", "--resume", "session-max-turns",
  ]);
});

test("failed background jobs expose a resumable Claude session ID", async () => {
  const bridge = new ClaudeBridge({
    run: async () => ({
      code: 1,
      stdout: JSON.stringify({
        subtype: "error_max_turns",
        session_id: "session-background-failed",
        result: "Reached maximum number of turns",
      }),
      stderr: "",
    }),
  });

  const job = bridge.delegateBackground({ task: "Large task", workDir: "/tmp/project" });
  await assert.rejects(job.done, /Reached maximum number of turns/);

  const status = bridge.status(job.jobId);
  assert.equal(status.jobId, job.jobId);
  assert.equal(status.state, "failed");
  assert.equal(status.sessionId, "session-background-failed");
  assert.equal(status.error, "Claude Code exited with code 1: Reached maximum number of turns");
  assert.equal(status.telemetry.exitCode, 1);
  assert.equal(status.telemetry.result.subtype, "error_max_turns");
});

test("restores persisted sessions and stable background-job IDs", async () => {
  const saved = [];
  const stateStore = {
    load: () => ({
      sessions: [["persisted-review", { workDir: "/tmp/project", policy: "review" }]],
      jobs: [{ jobId: "job-7", state: "completed", sessionId: "persisted-review", result: "previous" }],
      nextJobId: 8,
    }),
    save: (state) => saved.push(state),
  };
  const calls = [];
  const bridge = new ClaudeBridge({
    stateStore,
    run: async (command, args, options) => {
      calls.push({ args, options });
      return { code: 0, stderr: "", stdout: JSON.stringify({ subtype: "success", session_id: "persisted-review", result: "resumed" }) };
    },
  });

  const resumed = await bridge.continue({ sessionId: "persisted-review", prompt: "Re-check the diff" });
  const job = bridge.delegateBackground({ task: "Fresh task", workDir: "/tmp/project" });

  assert.equal(resumed.result, "resumed");
  assert.equal(calls[0].options.cwd, "/tmp/project");
  assert.match(calls[0].options.input, /READ-ONLY/);
  assert.equal(job.jobId, "job-8");
  assert.equal(bridge.status("job-7").result, "previous");
  assert.ok(saved.length > 0);
});

test("marks a persisted running job interrupted after bridge restart", () => {
  const stateStore = {
    load: () => ({ jobs: [{ jobId: "job-4", state: "running" }], nextJobId: 5 }),
    save: () => {},
  };
  const bridge = new ClaudeBridge({ stateStore, run: () => new Promise(() => {}) });

  assert.deepEqual(bridge.status("job-4"), {
    jobId: "job-4",
    state: "interrupted",
    error: "MCP bridge restarted before the Claude job completed",
  });
});

test("continue rejects untrusted restart recovery without persisted session metadata", async () => {
  const bridge = new ClaudeBridge({
    run: async () => {
      throw new Error("runner should not be invoked");
    },
  });

  await assert.rejects(
    () => bridge.continue({
      sessionId: "session-from-previous-process",
      prompt: "Resume after MCP restart",
      workDir: "/tmp/project",
      maxTurns: 99,
    }),
    /Unknown Claude session: session-from-previous-process/,
  );
});
