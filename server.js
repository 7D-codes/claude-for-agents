#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ClaudeBridge } from "./src/core.js";
import { runProcess } from "./src/runner.js";
import { FileStateStore } from "./src/state.js";
import { approvedProjectRoot, resolveProjectDir } from "./src/workspace.js";

const claudeBin = process.env.CLAUDE_BIN || "claude";
const statePath = process.env.CLAUDE_FOR_HERMES_STATE || join(homedir(), ".claude-for-hermes", "state.json");
const projectRoot = approvedProjectRoot();
const bridge = new ClaudeBridge({ claudeBin, run: runProcess, stateStore: new FileStateStore(statePath) });
const server = new McpServer({ name: "claude-for-hermes", version: "0.1.0" });

function projectDir(input) {
  return resolveProjectDir(input, { root: projectRoot });
}

function result(outcome) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        session_id: outcome.sessionId,
        result: outcome.result,
        telemetry: outcome.telemetry,
      }, null, 2),
    }],
  };
}

function errorMessage(error) {
  return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
}

const delegateSchema = {
  task: z.string().min(1),
  work_dir: z.string().optional(),
  model: z.string().optional(),
  max_turns: z.number().int().min(1).max(99).default(10),
  policy: z.enum(["code", "review"]).optional(),
  readonly: z.boolean().default(false),
  background: z.boolean().default(false),
};

server.tool(
  "claude_delegate",
  "Delegate a coding task to Claude Code. Captures an exact Claude session ID for follow-up.",
  delegateSchema,
  async ({ task, work_dir, model, max_turns, policy, readonly, background }) => {
    try {
      const input = { task, workDir: projectDir(work_dir), model, maxTurns: max_turns, policy, readonly };
      if (!background) return result(await bridge.delegate(input));
      const job = bridge.delegateBackground(input);
      job.done.catch(() => {});
      return { content: [{ type: "text", text: JSON.stringify({ job_id: job.jobId, state: "running" }) }] };
    } catch (error) {
      return errorMessage(error);
    }
  },
);

server.tool(
  "claude_continue",
  "Continue a Claude Code session by its exact session ID. Use IDs returned by claude_delegate.",
  {
    session_id: z.string().min(1),
    prompt: z.string().min(1),
    model: z.string().optional(),
    max_turns: z.number().int().min(1).max(99).default(10),
  },
  async ({ session_id, prompt, model, max_turns }) => {
    try {
      return result(await bridge.continue({
        sessionId: session_id,
        prompt,
        model,
        maxTurns: max_turns,
      }));
    } catch (error) {
      return errorMessage(error);
    }
  },
);

server.tool(
  "claude_review",
  "Run a read-only Claude Code review. Claude may read files and git diff/status only; it cannot edit.",
  {
    work_dir: z.string(),
    scope: z.string().default("current changes"),
    model: z.string().optional(),
    max_turns: z.number().int().min(1).max(99).default(10),
  },
  async ({ work_dir, scope, model, max_turns }) => {
    try {
      return result(await bridge.review({ workDir: projectDir(work_dir), scope, model, maxTurns: max_turns }));
    } catch (error) {
      return errorMessage(error);
    }
  },
);

server.tool(
  "claude_status",
  "List background Claude Code jobs, or get the current state and result of one job.",
  { job_id: z.string().min(1).optional() },
  async ({ job_id }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(bridge.status(job_id), null, 2) }] };
    } catch (error) {
      return errorMessage(error);
    }
  },
);

server.tool(
  "claude_cancel",
  "Cancel a currently running background Claude Code job.",
  { job_id: z.string().min(1) },
  async ({ job_id }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(bridge.cancel(job_id), null, 2) }] };
    } catch (error) {
      return errorMessage(error);
    }
  },
);

await server.connect(new StdioServerTransport());
