import { spawn } from "node:child_process";

export function runProcess(command, args, { cwd, signal, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, closeSignal) => resolve({
      code: code ?? 1,
      signal: closeSignal,
      stdout,
      stderr,
    }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  });
}
