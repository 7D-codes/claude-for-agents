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
- Max-turn failures retain their Claude session ID. Trusted session metadata is restored from the owner-only state file after an MCP process restart.
- Background work can run while Hermes continues other work.

## Tools

| Tool | Purpose |
| --- | --- |
| `claude_delegate` | Start a Claude Code task. Supports a project directory, model override, read-only mode, and background execution. |
| `claude_continue` | Continue a worker by its exact session ID rather than whichever session is newest in a directory; accepts an optional model override for the follow-up. |
| `claude_status` | List every background job or inspect one job's current state/result. |
| `claude_cancel` | Stop a running background worker. |
| `claude_review` | Run a constrained read-only review with explicit, validated model and turn-budget overrides. |

## Safety model

- Work is restricted to the approved project root. It defaults to `~/Projects` and can be changed with `CLAUDE_FOR_HERMES_PROJECT_ROOT`; traversal and symlink escapes are rejected.
- `claude_review` and `readonly: true` use the immutable `review` policy; continued review sessions retain that policy.
- Normal delegation uses the named `code` policy. Both policies use explicit Claude tool allowlists; the bridge does not use `--dangerously-skip-permissions`.
- Worker prompts are sent on stdin rather than command-line arguments.
- Delegation results and tracked background-job status preserve Claude's structured result telemetry (including parsed output events, timing/usage fields when supplied, stderr, and exit status).
- Unknown sessions cannot be resumed merely by supplying a directory; restart recovery comes only from an owner-only (`0600`) JSON state file at `~/.claude-for-hermes/state.json` (or `CLAUDE_FOR_HERMES_STATE`).
- Completed/failed jobs and session metadata persist across bridge restarts with stable IDs; jobs active during a restart are reported as `interrupted` and are never falsely resumed.
- Background cancellation terminates Claude's complete subprocess group with `SIGTERM`, then escalates to `SIGKILL` after a bounded grace period so child processes are not orphaned.
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

Optional runtime paths:

```bash
export CLAUDE_FOR_HERMES_PROJECT_ROOT="$HOME/Projects"
export CLAUDE_FOR_HERMES_STATE="$HOME/.claude-for-hermes/state.json"
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
node --check src/state.js
node --check src/workspace.js
```

The test suite covers exact worker-session continuation, immutable read-only restrictions, persistent job tracking, process-group cancellation, subprocess stdin/output handling, workspace containment, review configuration, and actionable authentication failures.
