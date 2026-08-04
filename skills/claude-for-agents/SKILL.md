---
name: claude-for-agents
description: Use when installing or operating Claude Code as an MCP worker.
version: 0.3.0
author: 7D-codes
license: MIT
compatibility: Requires git, Node.js 20+, the official Claude Code CLI, and a local stdio MCP host.
metadata:
  tags: [mcp, claude-code, coding-agents, delegation, code-review]
  repository: https://github.com/7D-codes/claude-for-agents
---

# Claude for Agents

## Overview

Claude for Agents turns the locally authenticated official Claude Code CLI into a persistent, permission-controlled MCP worker. A compatible supervisor such as Hermes or Codex can delegate work, receive structured telemetry, and continue the exact Claude session later.

Use this skill to install, update, configure, verify, operate, or troubleshoot the bridge. The runtime is installed from its GitHub source; it is not an npm package.

## When to Use

Use when the user wants to:

- add Claude Code as a worker beneath Hermes, Codex, or another stdio MCP host;
- delegate implementation or read-only review work to Claude;
- resume an exact Claude worker session;
- inspect or cancel background Claude jobs;
- update or troubleshoot an existing Claude for Agents installation.

Do not use this skill to:

- bypass Claude authentication, subscription limits, or provider controls;
- expose the bridge as a public or remote service;
- send secrets through prompts;
- treat an MCP configuration entry as proof that live tool discovery works.

## Safety Contract

1. **Local auth only.** Never ask for, read, print, copy, or type Claude credentials. Check `claude auth status`; if authentication is missing, tell the user to run `claude auth login` themselves and stop before live delegation.
2. **Approval before changes.** Explain before cloning, downloading dependencies, changing MCP configuration, or restarting an agent. Do not silently replace an existing MCP entry.
3. **Absolute paths.** Register the resolved Node executable and `server.js` path as separate stdio command/argument values. Do not rely on the host's working directory.
4. **Workspace boundary.** Keep the approved project root narrow. Default to `~/Projects`; do not broaden it to the home directory or filesystem root merely to make a task pass.
5. **Review first.** For an unfamiliar repository or installation test, start with `claude_review` or `policy: "review"`, not writable delegation.
6. **No false completion.** Configuration is complete only after the server connects and exposes exactly five tools.

## Install or Update

### 1. Inspect prerequisites

Run read-only checks:

```bash
command -v git
command -v node
node --version
command -v claude
claude auth status
```

Require Node.js 20 or newer. Treat the Claude CLI's live auth result as authoritative. Completion: git, Node, and Claude are present; authentication is either confirmed or clearly handed back to the user.

### 2. Choose the installation directory

Default new installations to:

```text
~/Projects/claude-for-agents
```

Before cloning, check whether either of these already exists:

```text
~/Projects/claude-for-agents
~/Projects/claude-for-hermes
```

The legacy directory can continue working. Do not rename or duplicate it while an MCP host still references its old absolute path. If reusing a clone, verify its origin and worktree first:

```bash
git remote get-url origin
git status --short
git branch --show-current
```

- New install: clone `https://github.com/7D-codes/claude-for-agents.git`.
- Clean existing install: update with `git pull --ff-only`.
- Modified existing install: stop and ask before changing it.

Completion: one trusted clone exists, its origin resolves to the official repository, and no user changes were overwritten.

### 3. Install and verify the runtime

From the repository root:

```bash
npm ci
npm test
npm run smoke
```

`npm run smoke` must report server name `claude-for-agents`, version `0.3.0` or newer, and exactly:

```text
claude_cancel
claude_continue
claude_delegate
claude_review
claude_status
```

Completion: dependencies install successfully, the test suite passes, and stdio discovery returns all five tools.

## Configure the MCP Host

Detect the host the user is actively configuring. If both Hermes and Codex are installed and intent is unclear, ask which one rather than modifying both.

Set these shell values from the verified clone:

```bash
NODE_BIN="$(command -v node)"
SERVER_JS="$(pwd)/server.js"
```

### Hermes

Inspect first:

```bash
hermes mcp list
```

For a new entry:

```bash
hermes mcp add claude_for_agents \
  --command "$NODE_BIN" \
  --connect-timeout 20 \
  --args "$SERVER_JS"
hermes mcp test claude_for_agents
```

If `claude_for_hermes` already exists, do not create a duplicate automatically. Offer either to keep the legacy key and update its source path, or replace it with `claude_for_agents`. Use Hermes CLI commands rather than hand-editing `~/.hermes/config.yaml`.

A new Hermes session or process is required before newly discovered tools appear in chat. Completion: `hermes mcp test claude_for_agents` connects and discovers five tools, and the restart requirement is explicit.

### Codex CLI

Inspect first:

```bash
codex mcp list
```

For a new entry:

```bash
codex mcp add claude_for_agents -- "$NODE_BIN" "$SERVER_JS"
codex mcp get claude_for_agents
```

If a legacy or duplicate entry exists, stop and ask before removing it. Restart Codex so it reloads MCP servers. Completion: `codex mcp get claude_for_agents` shows the intended absolute command and argument, and a fresh Codex session can see the five `claude_*` tools.

### Other stdio MCP hosts

Use the host's documented local stdio configuration with this contract:

```json
{
  "command": "/absolute/path/to/node",
  "args": ["/absolute/path/to/claude-for-agents/server.js"]
}
```

Keep command and arguments separate. Do not invent a configuration format for an unknown host; consult its current documentation. Completion: the host's own MCP diagnostics discover all five tools.

## Optional Runtime Configuration

Use the host's MCP environment configuration when setting runtime variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLAUDE_BIN` | `claude` | Claude Code executable path. |
| `CLAUDE_FOR_AGENTS_PROJECT_ROOT` | `~/Projects` | Approved root containing worker repositories. |
| `CLAUDE_FOR_AGENTS_STATE` | `~/.claude-for-agents/state.json` | Persistent session and job state. |

Legacy `CLAUDE_FOR_HERMES_PROJECT_ROOT` and `CLAUDE_FOR_HERMES_STATE` variables remain supported. The bridge reuses an existing legacy default state file when no new state file exists.

Do not set the approved project root to `/` or `$HOME` as a troubleshooting shortcut. Completion: custom paths are absolute or unambiguous, exist where required, and remain narrowly scoped.

## Operating the Worker

### Delegate implementation

Use `claude_delegate` with:

- a bounded task;
- an explicit `work_dir` beneath the approved root;
- `policy: "code"` for edits;
- an optional `max_turns` safety cap from 1 to 99 only when the supervisor wants a bounded run;
- `background: true` only when the supervisor will track the returned job ID.

Record the returned `session_id`. Completion: the worker result, telemetry, changed files, and tests are reviewed by the supervisor rather than accepted blindly.

### Run read-only review

Use `claude_review`, or `claude_delegate` with `policy: "review"`. Review sessions keep the immutable review policy when continued. Completion: findings are evidence-based and no files were edited.

### Continue exact work

Use `claude_continue` only with a session ID returned by this bridge. Do not substitute a directory's newest Claude session. Completion: the response retains the requested exact session ID.

### Track or cancel background work

- `claude_status` without a job ID lists tracked jobs.
- `claude_status` with a job ID inspects one job.
- `claude_cancel` stops a running job and its subprocess tree.

After a bridge restart, a formerly running job is reported as `interrupted`; it is not automatically resumed. Completion: final job state is observed after cancellation or settlement.

## Troubleshooting

### Authentication failure

Cause: the official Claude CLI is not currently authenticated.

Fix: ask the user to run:

```bash
claude auth login
```

Then rerun `claude auth status`. Never perform or automate the user's login flow.

### Server connects but host lacks tools

1. Run `npm run smoke` in the clone.
2. Inspect the host's MCP entry for absolute command and argument paths.
3. Run the host diagnostic (`hermes mcp test ...` or equivalent).
4. Restart the host/new session.

Do not claim success from configuration alone.

### Work directory rejected

The requested path is outside the approved project root, missing, or escapes through a symlink. Correct the path or deliberately configure a narrow alternate root through `CLAUDE_FOR_AGENTS_PROJECT_ROOT`. Do not weaken the boundary globally.

### Unknown session after restart

Only sessions present in the trusted owner-only state file can be resumed. Check whether the MCP host is launching with the intended `CLAUDE_FOR_AGENTS_STATE` and whether a legacy state path should be reused. Do not reconstruct trust from a caller-supplied directory.

### Existing legacy installation

The old repository URL redirects and the old environment variables remain accepted. Preserve a working legacy absolute path until the host configuration is deliberately updated. Avoid simultaneous old and new MCP entries pointing at the same runtime.

## Common Pitfalls

1. **Treating the skill as the runtime.** The installed skill gives the agent a procedure; the Node MCP server still comes from the GitHub clone.
2. **Publishing through npm by accident.** Use `npm ci` only for repository dependencies; this project is intentionally not distributed as an npm package.
3. **Registering `node server.js` as one string.** Stdio hosts need an executable plus an argument list.
4. **Testing with writable work.** Start with the built-in smoke test and a read-only review.
5. **Losing session history during rebrand.** Preserve the legacy state file or explicitly configure the new path.
6. **Duplicating MCP entries.** Inspect before adding and ask before replacing.
7. **Assuming Codex/Hermes hot-reloads MCP.** Restart or start a new session after registration.

## Verification Checklist

- [ ] Official GitHub clone and clean update path verified
- [ ] Node.js 20+, git, and Claude CLI present
- [ ] User-owned Claude authentication confirmed
- [ ] `npm test` passes
- [ ] `npm run smoke` discovers exactly five tools
- [ ] MCP command and `server.js` argument use absolute paths
- [ ] Approved project root remains narrow
- [ ] Host diagnostic succeeds
- [ ] Fresh host session exposes the tools
- [ ] Initial real task uses review policy or a narrowly scoped code task
