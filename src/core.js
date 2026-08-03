export class ClaudeBridge {
  constructor({ claudeBin = "claude", run }) {
    this.claudeBin = claudeBin;
    this.run = run;
    this.sessions = new Map();
  }

  async delegate({ task, workDir, model, maxTurns = 10 }) {
    const args = ["-p", "--output-format", "json", "--max-turns", String(maxTurns)];
    if (model) args.push("--model", model);
    args.push(task);
    const outcome = await this.#invoke(args, workDir);
    this.sessions.set(outcome.sessionId, { workDir, model });
    return { ...outcome, args };
  }

  async continue({ sessionId, prompt, maxTurns = 10 }) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown Claude session: ${sessionId}`);
    const args = [
      "-p", "--output-format", "json", "--max-turns", String(maxTurns),
      "--resume", sessionId, prompt,
    ];
    const outcome = await this.#invoke(args, session.workDir);
    return { ...outcome, args };
  }

  async #invoke(args, workDir) {
    const completed = await this.run(this.claudeBin, args, { cwd: workDir });
    if (completed.code !== 0) {
      const details = (completed.stderr || completed.stdout || "no output").trim();
      throw new Error(`Claude Code exited with code ${completed.code}: ${details}`);
    }

    let payload;
    try {
      payload = JSON.parse(completed.stdout);
    } catch {
      throw new Error("Claude Code returned invalid JSON output");
    }
    if (payload.subtype !== "success" || !payload.session_id) {
      throw new Error(payload.result || "Claude Code did not return a successful session");
    }
    return { sessionId: payload.session_id, result: payload.result || "" };
  }
}
