import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { LaunchStrategy } from "./types";

export type CockpitConfig = {
  workspaces: { path: string; label?: string }[];
  launch: { prefer?: LaunchStrategy };
  herdr: { poll: boolean; pollMs: number };
};
export type UiState = { lastWorkspace?: string; agentOpen?: boolean };

export const DEFAULT_CONFIG: CockpitConfig = { workspaces: [], launch: {}, herdr: { poll: true, pollMs: 3000 } };
const STRATEGIES: LaunchStrategy[] = ["herdr", "tmux", "zellij", "ghostty", "suspend"];

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ORG_OS_COCKPIT_HOME) return env.ORG_OS_COCKPIT_HOME;
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "org-os", "cockpit");
}

export function mergeConfig(raw: unknown): { config: CockpitConfig; errors: string[] } {
  const errors: string[] = [];
  const config: CockpitConfig = structuredClone(DEFAULT_CONFIG);
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  if (Array.isArray(obj.workspaces)) {
    obj.workspaces.forEach((w: any, i: number) => {
      if (w && typeof w.path === "string" && isAbsolute(w.path)) {
        config.workspaces.push(typeof w.label === "string" ? { path: w.path, label: w.label } : { path: w.path });
      } else {
        errors.push(`config.json workspaces[${i}]: needs an absolute "path"`);
      }
    });
  }
  if (obj.launch?.prefer !== undefined) {
    if (STRATEGIES.includes(obj.launch.prefer)) config.launch.prefer = obj.launch.prefer;
    else errors.push(`config.json launch.prefer: must be one of ${STRATEGIES.join(", ")}`);
  }
  if (obj.herdr && typeof obj.herdr === "object") {
    if (typeof obj.herdr.poll === "boolean") config.herdr.poll = obj.herdr.poll;
    if (typeof obj.herdr.pollMs === "number") config.herdr.pollMs = Math.max(1000, obj.herdr.pollMs);
  }
  return { config, errors };
}

export function loadConfig(dir: string): { config: CockpitConfig; errors: string[] } {
  let text: string;
  try {
    text = readFileSync(join(dir, "config.json"), "utf8");
  } catch {
    return { config: structuredClone(DEFAULT_CONFIG), errors: [] };
  }
  try {
    return mergeConfig(JSON.parse(text));
  } catch (e) {
    return { config: structuredClone(DEFAULT_CONFIG), errors: [`config.json: ${(e as Error).message}`] };
  }
}

export function loadUiState(dir: string): UiState {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
    const out: UiState = {};
    if (typeof raw.lastWorkspace === "string") out.lastWorkspace = raw.lastWorkspace;
    if (typeof raw.agentOpen === "boolean") out.agentOpen = raw.agentOpen;
    return out;
  } catch {
    return {};
  }
}

export function saveUiState(dir: string, state: UiState): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `state.json.${process.pid}.tmp`);
    writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
    renameSync(tmp, join(dir, "state.json"));
    return true;
  } catch {
    return false;
  }
}
