import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const DEFAULT_PROJECT_ROOT = "Projects";

function expandHome(input, home) {
  if (input === "~") return home;
  return input.replace(/^~\//, `${home}/`);
}

function existingDirectory(path, label) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} is not an existing directory: ${path}`);
  }
  return path;
}

function contains(root, path) {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function approvedProjectRoot(env = process.env, home = homedir()) {
  const configured = env.CLAUDE_FOR_AGENTS_PROJECT_ROOT?.trim()
    || env.CLAUDE_FOR_HERMES_PROJECT_ROOT?.trim();
  const root = resolve(expandHome(configured || join(home, DEFAULT_PROJECT_ROOT), home));
  return realpathSync(existingDirectory(root, "approved project root"));
}

export function resolveProjectDir(input, { root, home = homedir(), cwd = process.cwd() } = {}) {
  const requested = typeof input === "string" && input.trim() ? input.trim() : cwd;
  const directory = resolve(expandHome(requested, home));
  // Canonicalize before the boundary check so symlinked components cannot escape the root.
  const real = realpathSync(existingDirectory(directory, "work_dir"));
  if (!contains(root, directory) || !contains(root, real)) {
    throw new Error(`work_dir is outside the approved project root ${root}: ${real}`);
  }
  return real;
}
