# Claude for Agents

Use the authenticated **Claude Code CLI as a persistent, permission-controlled worker from any stdio MCP-compatible agent**.

Claude for Agents is a local Node.js MCP server. A supervisor such as Hermes or Codex can delegate focused implementation or review work, receive structured telemetry, and continue the exact Claude session later.

## Architecture

```text
You → MCP-compatible supervisor → Claude for Agents → Claude Code worker
                              ← result / session ID ←
```

The bridge uses Claude Code print mode (`claude -p`) for autonomous worker calls while the host agent remains the supervisor.

## Tools

| Tool | Purpose |
| --- | --- |
| `claude_delegate` | Start a Claude Code task with project, model, policy, turn-budget, and background options. |
| `claude_continue` | Resume the exact stored Claude session, optionally with a model override. |
| `claude_status` | List background jobs or inspect one job's state and result. |
| `claude_cancel` | Stop a running background worker and its subprocess tree. |
| `claude_review` | Run a constrained, read-only review. |

## Safety model

- Work is restricted to an approved project root, defaulting to `~/Projects`.
- `review` is immutable across continuation and uses an inspection-only tool allowlist.
- `code` uses an explicit editing/testing allowlist; the bridge never uses `--dangerously-skip-permissions`.
- Worker prompts travel over stdin rather than command-line arguments.
- Sessions and job history persist in an owner-only (`0600`) state file.
- Jobs active during a bridge restart become `interrupted`; they are never falsely resumed.
- Cancellation targets the full subprocess group with bounded `SIGTERM` → `SIGKILL` escalation.
- The official Claude Code CLI must already be installed and authenticated locally.

## Install with an agent skill

The repository includes a portable [Agent Skill](https://skills.sh/) that can install, configure, verify, operate, and troubleshoot the bridge:

```bash
npx skills add 7D-codes/claude-for-agents --skill claude-for-agents
```

The skill supports Hermes and Codex directly and provides the stdio configuration contract for other MCP hosts. The skill is procedural guidance; the bridge runtime remains source-hosted in this GitHub repository and is not published as an npm package.

## Install from source

Requirements:

- Node.js 20+
- Git
- Official Claude Code CLI, authenticated with `claude auth login`
- An MCP host that supports local stdio servers

```bash
git clone https://github.com/7D-codes/claude-for-agents.git ~/Projects/claude-for-agents
cd ~/Projects/claude-for-agents
npm ci
npm test
npm run smoke
```

### Hermes

```bash
cd ~/Projects/claude-for-agents
hermes mcp add claude_for_agents \
  --command "$(command -v node)" \
  --connect-timeout 20 \
  --args "$PWD/server.js"
hermes mcp test claude_for_agents
```

Start a new Hermes session after registration so the five tools are loaded.

### Codex CLI

```bash
cd ~/Projects/claude-for-agents
codex mcp add claude_for_agents -- "$(command -v node)" "$PWD/server.js"
codex mcp get claude_for_agents
```

Restart Codex after registration. Ask it to list the tools exposed by `claude_for_agents`, then begin with a read-only `claude_review` or a narrowly scoped `claude_delegate` call.

### Other MCP hosts

Register this stdio server using absolute paths:

```json
{
  "command": "/absolute/path/to/node",
  "args": ["/absolute/path/to/claude-for-agents/server.js"]
}
```

Do not place the command and arguments into one shell string unless the host explicitly requires that format.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_BIN` | `claude` | Claude Code executable. |
| `CLAUDE_FOR_AGENTS_PROJECT_ROOT` | `~/Projects` | Approved root containing worker projects. |
| `CLAUDE_FOR_AGENTS_STATE` | `~/.claude-for-agents/state.json` | Persistent sessions and job history. |

The legacy `CLAUDE_FOR_HERMES_PROJECT_ROOT` and `CLAUDE_FOR_HERMES_STATE` names remain accepted. If the new default state file does not exist but `~/.claude-for-hermes/state.json` does, the bridge reuses the legacy file automatically.

Environment variables must be configured on the MCP subprocess through the host, not merely exported in an unrelated shell.

## Example requests

> Ask Claude to implement the API validation work in `~/Projects/my-app`, run the relevant tests, and report the changed files.

> Ask Claude to inspect the authentication module using the review policy and identify security risks without editing files.

> Continue Claude session `<session-id>`: address the review findings and rerun the focused tests.

## Development

```bash
npm test
npm run smoke
node --check server.js
node --check src/core.js
node --check src/config.js
node --check src/runner.js
node --check src/state.js
node --check src/workspace.js
```

The suite covers exact-session continuation, immutable review restrictions, persistent jobs, process-group cancellation, stdin transport, structured output, workspace containment, configuration migration, review settings, and authentication failures.

## License

[MIT](LICENSE)
