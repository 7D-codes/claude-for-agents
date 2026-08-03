export class ClaudeBridge {
  constructor({ claudeBin = "claude", run }) {
    this.claudeBin = claudeBin;
    this.run = run;
    this.sessions = new Map();
    this.jobs = new Map();
    this.nextJobId = 1;
  }

  delegateBackground(input) {
    const jobId = `job-${this.nextJobId++}`;
    const controller = new AbortController();
    const job = { jobId, state: "running", controller };
    this.jobs.set(jobId, job);
    const done = this.delegate({ ...input, signal: controller.signal }).then(
      (outcome) => {
        if (job.state === "running") {
          Object.assign(job, { state: "completed", sessionId: outcome.sessionId, result: outcome.result });
        }
        return outcome;
      },
      (error) => {
        if (job.state === "running") {
          const failure = { state: "failed", error: error.message };
          if (error.sessionId) failure.sessionId = error.sessionId;
          Object.assign(job, failure);
        }
        throw error;
      },
    );
    job.done = done;
    return { jobId, done };
  }

  status(jobId) {
    if (jobId === undefined) {
      return [...this.jobs.values()].map(({ done, controller, ...status }) => status);
    }
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown Claude job: ${jobId}`);
    const { done, controller, ...status } = job;
    return status;
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Unknown Claude job: ${jobId}`);
    if (job.state !== "running") return this.status(jobId);
    job.state = "cancelled";
    job.controller.abort();
    return this.status(jobId);
  }

  async delegate({ task, workDir, model, maxTurns = 10, readonly = false, signal }) {
    const args = ["-p", "--output-format", "json", "--max-turns", String(maxTurns)];
    if (model) args.push("--model", model);
    if (readonly) {
      args.push("--allowedTools", "Read,Bash(git diff *),Bash(git status *)");
      task = "IMPORTANT: This is a READ-ONLY task. Do not edit files or run state-changing commands.\n\n" + task;
    } else {
      args.push("--dangerously-skip-permissions");
    }
    args.push(task);
    try {
      const outcome = await this.#invoke(args, workDir, signal);
      this.sessions.set(outcome.sessionId, { workDir, model });
      return { ...outcome, args };
    } catch (error) {
      if (error.sessionId) this.sessions.set(error.sessionId, { workDir, model });
      throw error;
    }
  }

  async continue({ sessionId, prompt, model, maxTurns = 10, workDir }) {
    const session = this.sessions.get(sessionId) || (workDir ? { workDir, model } : undefined);
    if (!session) throw new Error(`Unknown Claude session: ${sessionId}`);
    this.sessions.set(sessionId, session);
    const args = ["-p", "--output-format", "json", "--max-turns", String(maxTurns)];
    if (model) args.push("--model", model);
    args.push("--dangerously-skip-permissions", "--resume", sessionId, prompt);
    const outcome = await this.#invoke(args, session.workDir);
    return { ...outcome, args };
  }

  async review({ workDir, scope = "current changes" }) {
    const prompt = "Review current changes for bugs, security issues, regressions, and missing tests. " +
      `Scope: ${scope}. Do not edit files or run state-changing commands.`;
    const args = [
      "-p", "--output-format", "json", "--max-turns", "5",
      "--allowedTools", "Read,Bash(git diff *),Bash(git status *)", prompt,
    ];
    const outcome = await this.#invoke(args, workDir);
    return { ...outcome, args };
  }

  async #invoke(args, workDir, signal) {
    const completed = await this.run(this.claudeBin, args, { cwd: workDir, signal });
    let payload;
    try {
      payload = JSON.parse(completed.stdout);
    } catch {
      payload = undefined;
    }
    if (completed.code !== 0) {
      const details = (completed.stderr || completed.stdout || "no output").trim();
      const message = payload?.result || details;
      if (/authenticate|oauth session expired|not logged in/i.test(message)) {
        throw new Error("Claude Code authentication failed. Run `claude auth login` in a terminal, then retry.");
      }
      const error = new Error(`Claude Code exited with code ${completed.code}: ${message}`);
      if (payload?.session_id) error.sessionId = payload.session_id;
      throw error;
    }

    if (!payload) {
      throw new Error("Claude Code returned invalid JSON output");
    }
    if (payload.subtype !== "success" || !payload.session_id) {
      throw new Error(payload.result || "Claude Code did not return a successful session");
    }
    return { sessionId: payload.session_id, result: payload.result || "" };
  }
}
