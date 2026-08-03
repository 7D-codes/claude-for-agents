# Claude for Hermes

A local MCP server that lets **Hermes supervise Claude Code** in the same way [`kimi-for-claude`](https://github.com/7D-codes/kimi-for-claude) lets Claude Code supervise Kimi.

You keep talking to Hermes in your normal chat. Hermes delegates focused coding, research, or review work to the authenticated official Claude Code CLI, receives a concise result, and remains the ongoing manager of the conversation.

## Architecture

```text
You → Hermes (ongoing conversation) → claude-for-hermes MCP → Claude Code worker
                                 ← result / session ID ←
```

A Claude worker invocation uses Claude Code print mode (`claude -p`) so it can run autonomously. That does **not** make the Hermes conversation one-shot:

- Hermes remains the supervisor in the same conversation.
- `claude_delegate` starts a worker task and returns its exact Claude session ID.
- `claude_continue` resumes that exact worker session for fixes or follow-ups.
- Delegate and continuation calls support up to 99 turns.
- Max-turn failures retain their Claude session ID. After an MCP process restart, pass the original `work_dir` to `claude_continue` to recover that exact session.
- Background work can run while Hermes continues other work.

## Tools

| Tool | Purpose |
| --- | --- |
| `claude_delegate` | Start a Claude Code task. Supports a project directory, model override, read-only mode, and background execution. |
| `claude_continue` | Continue a worker by its exact session ID rather than whichever session is newest in a directory; accepts an optional model override for the follow-up. |
| `claude_status` | List every background job or inspect one job's current state/result. |
| `claude_cancel` | Stop a running background worker. |
| `claude_review` | Run a constrained read-only review of a project. |

## Safety model

- Work only happens in an explicit `work_dir` when one is supplied.
- `claude_review` and `readonly: true` constrain Claude Code to inspection-only tools.
- For normal delegate/continue tasks, Hermes is the approval gate: the worker is launched non-interactively with Claude Code permissions enabled so an explicitly authorized task can write files and run its requested commands.
- Background cancellation sends an abort signal to the spawned Claude Code process.
- Claude Code must already be installed and authenticated locally.

## Install for Hermes

```bash
cd ~/Projects/claude-for-hermes
npm install
hermes mcp add claude_for_hermes \
  --command "$(command -v node)" \
  --connect-timeout 20 \
  --args "$PWD/server.js"
```

Then start a new Hermes session so it discovers the MCP tools. Confirm the server can connect:

```bash
hermes mcp test claude_for_hermes
```

## Example requests

In a Hermes chat:

> Ask Claude to implement the API validation work in `~/Projects/my-app`. Keep the task focused, run the relevant tests, and report the changed files.

> Ask Claude to inspect the authentication module in read-only mode and identify security risks.

> Continue Claude session `<session-id>`: fix the failing tests and report the outcome.

## Development

```bash
npm test
node --check server.js
node --check src/core.js
node --check src/runner.js
```

The test suite covers exact worker-session continuation, read-only restrictions, job tracking/cancellation, subprocess output capture, and actionable authentication failures.
