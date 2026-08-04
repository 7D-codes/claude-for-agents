const POLICY_DEFINITIONS = {
  review: {
    readonly: true,
    allowedTools: "Read,Bash(git diff *),Bash(git status *),Bash(npm test),Bash(npm test *),Bash(node --check *)",
  },
  code: {
    readonly: false,
    allowedTools: "Read,Edit,Write,Bash(npm test),Bash(npm test *),Bash(node --check *),Bash(git diff *),Bash(git status *)",
  },
};

function getPolicy(name) {
  const policy = POLICY_DEFINITIONS[name];
  if (!policy) throw new Error(`Unknown Claude permission policy: ${name}`);
  return { name, ...policy };
}

function promptFor(policy, prompt) {
  if (!policy.readonly) return prompt;
  return "IMPORTANT: This is a READ-ONLY task. Do not edit files or run state-changing commands.\n\n" + prompt;
}

function validateInvocation(model, maxTurns) {
  if (model !== undefined && (typeof model !== "string" || !model.trim())) {
    throw new Error("model must be a non-empty string");
  }
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 99) {
    throw new Error("maxTurns must be an integer between 1 and 99");
  }
  return { model: model?.trim(), maxTurns };
}

function parseClaudeOutput(stdout) {
  const text = stdout.trim();
  if (!text) return { payload: undefined, events: [] };
  try {
    const payload = JSON.parse(text);
    return { payload, events: [payload] };
  } catch {
    const events = text.split("\n").flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const payload = [...events].reverse().find((event) => event.session_id || event.type === "result");
    return { payload, events };
  }
}

export class ClaudeBridge {
  constructor({ claudeBin = "claude", run, stateStore } = {}) {
    this.claudeBin = claudeBin;
    this.run = run;
    this.stateStore = stateStore;
    const restored = stateStore?.load() || {};
    this.sessions = new Map(restored.sessions || []);
    let interrupted = false;
    this.jobs = new Map((restored.jobs || []).map((job) => {
      if (job.state === "running") {
        interrupted = true;
        job = {
          ...job,
          state: "interrupted",
          error: "MCP bridge restarted before the Claude job completed",
        };
      }
      return [job.jobId, job];
    }));
    this.nextJobId = restored.nextJobId || 1;
    if (interrupted) this.#persist();
  }

  #persist() {
    if (!this.stateStore) return;
    const jobs = [...this.jobs.values()].map(({ done, controller, ...job }) => job);
    this.stateStore.save({
      sessions: [...this.sessions.entries()],
      jobs,
      nextJobId: this.nextJobId,
    });
  }

  delegateBackground(input) {
    const jobId = `job-${this.nextJobId++}`;
    const controller = new AbortController();
    const job = { jobId, state: "running", controller };
    this.jobs.set(jobId, job);
    this.#persist();
    const done = this.delegate({ ...input, signal: controller.signal }).then(
      (outcome) => {
        if (job.state === "running") {
          Object.assign(job, {
            state: "completed",
            sessionId: outcome.sessionId,
            result: outcome.result,
            telemetry: outcome.telemetry,
          });
        }
        this.#persist();
        return outcome;
      },
      (error) => {
        if (job.state === "running") {
          const failure = { state: "failed", error: error.message };
          if (error.sessionId) failure.sessionId = error.sessionId;
          if (error.telemetry) failure.telemetry = error.telemetry;
          Object.assign(job, failure);
        }
        this.#persist();
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
    this.#persist();
    return this.status(jobId);
  }

  async delegate({ task, workDir, model, maxTurns = 10, policy, readonly = false, signal }) {
    ({ model, maxTurns } = validateInvocation(model, maxTurns));
    const activePolicy = getPolicy(readonly ? "review" : (policy || "code"));
    const args = ["-p", "--output-format", "json", "--max-turns", String(maxTurns)];
    if (model) args.push("--model", model);
    args.push("--allowedTools", activePolicy.allowedTools);
    const input = promptFor(activePolicy, task);
    try {
      const outcome = await this.#invoke(args, workDir, input, signal);
      this.sessions.set(outcome.sessionId, { workDir, model, policy: activePolicy.name, allowedTools: activePolicy.allowedTools });
      this.#persist();
      return { ...outcome, args };
    } catch (error) {
      if (error.sessionId) {
        this.sessions.set(error.sessionId, { workDir, model, policy: activePolicy.name, allowedTools: activePolicy.allowedTools });
        this.#persist();
      }
      throw error;
    }
  }

  async continue({ sessionId, prompt, model, maxTurns = 10 }) {
    ({ model, maxTurns } = validateInvocation(model, maxTurns));
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown Claude session: ${sessionId}`);
    const activePolicy = getPolicy(session.policy);
    const args = ["-p", "--output-format", "json", "--max-turns", String(maxTurns)];
    if (model) args.push("--model", model);
    args.push("--allowedTools", activePolicy.allowedTools, "--resume", sessionId);
    const outcome = await this.#invoke(args, session.workDir, promptFor(activePolicy, prompt));
    return { ...outcome, args };
  }

  async review({ workDir, scope = "current changes", model, maxTurns = 10 }) {
    const task = "Review current changes for bugs, security issues, regressions, and missing tests. " +
      `Scope: ${scope}. Run only allowed read-only checks if useful. Do not edit files or run state-changing commands.`;
    return this.delegate({ task, workDir, model, maxTurns, policy: "review" });
  }

  async #invoke(args, workDir, input, signal) {
    const completed = await this.run(this.claudeBin, args, { cwd: workDir, signal, input });
    const { payload, events } = parseClaudeOutput(completed.stdout);
    const telemetry = {
      exitCode: completed.code,
      signal: completed.signal,
      stderr: completed.stderr,
      events,
      result: payload,
    };
    if (completed.code !== 0) {
      const details = (completed.stderr || completed.stdout || "no output").trim();
      const message = payload?.result || details;
      if (/authenticate|oauth session expired|not logged in/i.test(message)) {
        const error = new Error("Claude Code authentication failed. Run `claude auth login` in a terminal, then retry.");
        if (payload?.session_id) error.sessionId = payload.session_id;
        error.telemetry = telemetry;
        throw error;
      }
      const error = new Error(`Claude Code exited with code ${completed.code}: ${message}`);
      if (payload?.session_id) error.sessionId = payload.session_id;
      error.telemetry = telemetry;
      throw error;
    }

    if (!payload) {
      throw new Error("Claude Code returned invalid JSON output");
    }
    if (payload.subtype !== "success" || !payload.session_id) {
      throw new Error(payload.result || "Claude Code did not return a successful session");
    }
    return { sessionId: payload.session_id, result: payload.result || "", telemetry };
  }
}
