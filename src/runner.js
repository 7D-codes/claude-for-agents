import { spawn } from "node:child_process";

export function runProcess(command, args, { cwd, signal, input, killGraceMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd,
      detached: useProcessGroup,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer;

    const clearKillTimer = () => {
      if (killTimer) clearTimeout(killTimer);
    };
    const terminate = (killSignal) => {
      try {
        if (useProcessGroup && child.pid) process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const abort = () => {
      if (settled) return;
      terminate("SIGTERM");
      killTimer = setTimeout(() => {
        if (!settled) terminate("SIGKILL");
      }, killGraceMs);
      killTimer.unref?.();
    };

    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE" && !settled) {
        settled = true;
        clearKillTimer();
        reject(error);
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearKillTimer();
      reject(error);
    });
    child.on("close", (code, closeSignal) => {
      if (settled) return;
      settled = true;
      clearKillTimer();
      resolve({
        code: code ?? 1,
        signal: closeSignal,
        stdout,
        stderr,
      });
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
