import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function stateFilePath(env = process.env, home = homedir(), exists = existsSync) {
  const configured = env.CLAUDE_FOR_AGENTS_STATE?.trim() || env.CLAUDE_FOR_HERMES_STATE?.trim();
  if (configured) return configured;

  const current = join(home, ".claude-for-agents", "state.json");
  const legacy = join(home, ".claude-for-hermes", "state.json");
  if (!exists(current) && exists(legacy)) return legacy;
  return current;
}
