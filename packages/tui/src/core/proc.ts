import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export type ProcResult = { code: number | null; stdout: string; stderr: string; error?: string; timedOut?: boolean };
export type RunOptions = { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; input?: string };
export type Runner = (cmd: string, args: string[], opts?: RunOptions) => Promise<ProcResult>;

export const run: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: ProcResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      finish({ code: null, stdout: "", stderr: "", error: (e as Error).message });
      return;
    }
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, opts.timeoutMs);
    }
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (e) => finish({ code: null, stdout, stderr, error: e.message }));
    child.on("close", (code) => finish({ code: timedOut ? null : code, stdout, stderr, ...(timedOut ? { timedOut: true } : {}) }));
    child.stdin?.on("error", () => {});
    if (opts.input !== undefined) child.stdin?.end(opts.input);
    else child.stdin?.end();
  });

export function which(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const dirs = bin.includes("/") ? [""] : String(env.PATH ?? "").split(delimiter);
  for (const dir of dirs) {
    try {
      accessSync(dir ? join(dir, bin) : bin, constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}
