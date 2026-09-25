import { existsSync } from "node:fs";
import type { HerdrClient } from "./herdr";
import { which, type Runner } from "./proc";
import type { ForegroundEffect, HostId, LaunchStrategy, Placement } from "./types";
import { slug } from "./util";

export type LaunchEnv = { env: NodeJS.ProcessEnv; platform: string; has: (bin: string) => boolean; ghosttyInstalled: boolean };

export function detectLaunchEnv(env: NodeJS.ProcessEnv = process.env): LaunchEnv {
  return { env, platform: process.platform, has: (b) => which(b, env), ghosttyInstalled: existsSync("/Applications/Ghostty.app") };
}

const ORDER: LaunchStrategy[] = ["herdr", "tmux", "zellij", "ghostty", "suspend"];

function viable(le: LaunchEnv, s: LaunchStrategy): boolean {
  switch (s) {
    case "herdr":
      return le.env.HERDR_ENV === "1" && le.has(le.env.HERDR_BIN_PATH || "herdr");
    case "tmux":
      return !!le.env.TMUX && le.has("tmux");
    case "zellij":
      return !!le.env.ZELLIJ && le.has("zellij");
    case "ghostty":
      return le.platform === "darwin" && le.ghosttyInstalled;
    case "suspend":
      return true;
  }
}

export function viableStrategies(le: LaunchEnv, prefer?: LaunchStrategy): LaunchStrategy[] {
  const list = ORDER.filter((s) => viable(le, s));
  if (prefer && list.includes(prefer)) return [prefer, ...list.filter((s) => s !== prefer)];
  return list;
}

export const HOST_BIN: Record<HostId, string> = { claude: "claude", pi: "pi", opencode: "opencode" };

// herdr agent names: [a-z][a-z0-9_-]{0,31}, unique among live agents.
export function agentName(wsId: string, host: HostId, taken: string[]): string {
  let base = slug(`${wsId}-${host}`);
  if (!/^[a-z]/.test(base)) base = `a-${base}`;
  base = base.slice(0, 29).replace(/-+$/, "");
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${n}`;
  return name;
}

export type LaunchRequest = { host: HostId; placement: Placement; cwd: string; wsId: string; paneCols: number; takenNames: string[] };
export type LaunchOutcome =
  | { ok: true; strategy: LaunchStrategy; detail: string }
  | { ok: true; strategy: "suspend"; foreground: ForegroundEffect }
  | { ok: false; error: string; tried: LaunchStrategy[] };
export type LaunchDeps = { le: LaunchEnv; strategies: LaunchStrategy[]; run: Runner; herdr: HerdrClient | null };

async function expectOk(run: Runner, cmd: string, args: string[]) {
  const r = await run(cmd, args, { timeoutMs: 10_000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || r.error || `${cmd} exited ${r.code}`);
}

export async function launchHost(req: LaunchRequest, deps: LaunchDeps): Promise<LaunchOutcome> {
  const bin = HOST_BIN[req.host];
  if (!deps.le.has(bin)) return { ok: false, error: `${bin} is not installed (not on PATH)`, tried: [] };
  const errors: string[] = [];
  const tried: LaunchStrategy[] = [];
  for (const strategy of deps.strategies) {
    tried.push(strategy);
    try {
      switch (strategy) {
        case "herdr": {
          if (!deps.herdr) throw new Error("herdr client unavailable");
          const name = agentName(req.wsId, req.host, req.takenNames);
          const paneId =
            req.placement === "split"
              ? await deps.herdr.splitPane({ cwd: req.cwd, direction: req.paneCols >= 120 ? "right" : "down" })
              : await deps.herdr.createTab({ cwd: req.cwd, label: `${req.wsId}:${req.host}` });
          try {
            await deps.herdr.startAgent({ name, kind: req.host, paneId });
          } catch (e) {
            await deps.herdr.closePane(paneId).catch(() => {});
            throw e;
          }
          return { ok: true, strategy, detail: `herdr ${req.placement} ${paneId} (${name})` };
        }
        case "tmux":
          await expectOk(deps.run, "tmux", req.placement === "split" ? ["split-window", "-h", "-c", req.cwd, bin] : ["new-window", "-c", req.cwd, bin]);
          return { ok: true, strategy, detail: `tmux ${req.placement === "split" ? "split" : "window"}` };
        case "zellij":
          if (req.placement === "tab") await expectOk(deps.run, "zellij", ["action", "new-tab", "--cwd", req.cwd]);
          await expectOk(deps.run, "zellij", ["run", "--cwd", req.cwd, "--", bin]);
          return { ok: true, strategy, detail: `zellij ${req.placement}` };
        case "ghostty":
          await expectOk(deps.run, "open", ["-na", "Ghostty.app", "--args", `--working-directory=${req.cwd}`, "-e", bin]);
          return { ok: true, strategy, detail: "new Ghostty window" };
        case "suspend":
          return { ok: true, strategy: "suspend", foreground: { type: "foreground", cmd: bin, args: [], cwd: req.cwd } };
      }
    } catch (e) {
      errors.push(`${strategy}: ${(e as Error).message}`);
    }
  }
  return { ok: false, error: errors.join("; ") || "no launch strategy available", tried };
}

// Why a foreground command (a suspend-and-run host, the editor) did not finish cleanly, or null.
export function foregroundProblem(
  cmd: string,
  r: { error?: Error & { code?: string }; status: number | null; signal?: string | null },
): string | null {
  if (r.error) return r.error.code === "ENOENT" ? `\`${cmd}\` not found` : `\`${cmd}\` could not start: ${r.error.message}`;
  if (r.signal) return `\`${cmd}\` was stopped by ${r.signal}`;
  if (r.status !== null && r.status !== 0) return `\`${cmd}\` exited with ${r.status}`;
  return null;
}
