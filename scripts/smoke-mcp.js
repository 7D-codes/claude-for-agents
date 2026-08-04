#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const expected = [
  "claude_cancel",
  "claude_continue",
  "claude_delegate",
  "claude_review",
  "claude_status",
];
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(repository, "server.js")],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === "string")),
    CLAUDE_FOR_AGENTS_STATE: join(tmpdir(), `claude-for-agents-smoke-${process.pid}.json`),
  },
});
const client = new Client({ name: "claude-for-agents-smoke", version: "1.0.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map(({ name }) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected MCP tools: ${names.join(", ")}`);
  }
  console.log(JSON.stringify({ server: client.getServerVersion(), tools: names }, null, 2));
} finally {
  await client.close();
}
