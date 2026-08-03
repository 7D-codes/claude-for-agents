# Claude for Hermes

A local MCP server that lets Hermes delegate coding tasks to the authenticated official Claude Code CLI.

## Intended tools

- `claude_delegate` — start an isolated Claude Code coding/research session.
- `claude_continue` — resume a specific Claude session by its captured ID.
- `claude_status` / `claude_cancel` — manage tracked background sessions.
- `claude_review` — run a scoped read-only review.

The server is local-only. Hermes decides when to delegate; Claude Code works only in the supplied project directory.
