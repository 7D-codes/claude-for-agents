import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { approvedProjectRoot, resolveProjectDir } from "../src/workspace.js";

test("approved project root defaults to ~/Projects and accepts a project inside it", () => {
  const root = approvedProjectRoot({});

  assert.equal(root, realpathSync(join(homedir(), "Projects")));
  assert.equal(
    resolveProjectDir("~/Projects/claude-for-hermes", { root }),
    realpathSync(join(homedir(), "Projects", "claude-for-hermes")),
  );
  assert.equal(
    resolveProjectDir("/Users/7d/Projects/claude-for-hermes", { root }),
    realpathSync(join(homedir(), "Projects", "claude-for-hermes")),
  );
});

test("prefers the Claude for Agents project-root setting while accepting the legacy alias", () => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "claude-for-agents-config-"));
  const current = join(base, "current");
  const legacy = join(base, "legacy");
  mkdirSync(current);
  mkdirSync(legacy);
  try {
    assert.equal(
      approvedProjectRoot({
        CLAUDE_FOR_AGENTS_PROJECT_ROOT: current,
        CLAUDE_FOR_HERMES_PROJECT_ROOT: legacy,
      }),
      current,
    );
    assert.equal(approvedProjectRoot({ CLAUDE_FOR_HERMES_PROJECT_ROOT: legacy }), legacy);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rejects traversal out of a configured project root, including sibling name prefixes", () => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "claude-for-hermes-roots-"));
  const root = join(base, "root");
  const sibling = join(base, "root-evil");
  mkdirSync(join(root, "app"), { recursive: true });
  mkdirSync(sibling, { recursive: true });
  try {
    const configured = approvedProjectRoot({ CLAUDE_FOR_HERMES_PROJECT_ROOT: root });
    assert.equal(configured, root);
    assert.equal(resolveProjectDir(join(root, "app"), { root: configured }), join(root, "app"));

    assert.throws(
      () => resolveProjectDir(join(root, "app", "..", "..", "root-evil"), { root: configured }),
      /outside the approved project root/,
    );
    assert.throws(
      () => resolveProjectDir(sibling, { root: configured }),
      /outside the approved project root/,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("an omitted work directory falls back to the working directory and is still validated", () => {
  const root = approvedProjectRoot({});
  const repository = realpathSync(join(homedir(), "Projects", "claude-for-hermes"));

  assert.equal(resolveProjectDir(undefined, { root, cwd: repository }), repository);
  assert.throws(
    () => resolveProjectDir(undefined, { root, cwd: realpathSync(tmpdir()) }),
    /outside the approved project root/,
  );
});

test("rejects symlinks that escape the approved project root", () => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "claude-for-hermes-links-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  mkdirSync(join(outside, "secrets"), { recursive: true });
  mkdirSync(root, { recursive: true });
  symlinkSync(outside, join(root, "escape"));
  symlinkSync(join(outside, "secrets"), join(root, "nested-escape"));
  try {
    const configured = approvedProjectRoot({ CLAUDE_FOR_HERMES_PROJECT_ROOT: root });
    assert.throws(
      () => resolveProjectDir(join(root, "escape"), { root: configured }),
      /outside the approved project root/,
    );
    assert.throws(
      () => resolveProjectDir(join(root, "escape", "secrets"), { root: configured }),
      /outside the approved project root/,
    );
    assert.throws(
      () => resolveProjectDir(join(root, "nested-escape"), { root: configured }),
      /outside the approved project root/,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rejects a work directory outside the approved project root", () => {
  const outside = mkdtempSync(join(realpathSync(tmpdir()), "claude-for-hermes-outside-"));
  try {
    assert.throws(
      () => resolveProjectDir(outside, { root: realpathSync(join(homedir(), "Projects")) }),
      /outside the approved project root/,
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
