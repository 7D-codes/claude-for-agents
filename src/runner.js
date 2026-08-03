import { spawn } from "node:child_process";

export function runProcess(command, args, { cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
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
    signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  });
}
