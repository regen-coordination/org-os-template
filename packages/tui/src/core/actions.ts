import { run as defaultRun, type Runner } from "./proc";
import { HOSTS, LIFECYCLE_COMMANDS, type HostId, type LifecycleCommand, type Placement } from "./types";
import type { LoadedWorkspace } from "./workspace";

// npm scripts the cockpit may run directly. Everything else goes through an
// agent (guarded) or the operator.
export const SCRIPT_ALLOWLIST = ["initialize", "generate:schemas", "validate:schemas", "validate:structure", "doctor", "knowledge"];

export type ActionDef =
  | { id: string; label: string; kind: "script"; script: string }
  | { id: string; label: string; kind: "open" }
  | { id: string; label: string; kind: "agent"; command: LifecycleCommand }
  | { id: string; label: string; kind: "launch"; host: HostId; placement: Placement };

export function workspaceScripts(files: Record<string, string>): Record<string, string> {
  try {
    return JSON.parse(files["package.json"] ?? "{}").scripts ?? {};
  } catch {
    return {};
  }
}

export function actionsFor(ws: LoadedWorkspace | null): ActionDef[] {
  const out: ActionDef[] = [{ id: "open-source", label: "Open this page's file in $EDITOR", kind: "open" }];
  for (const command of LIFECYCLE_COMMANDS) out.push({ id: `agent:${command}`, label: `Agent: /${command}`, kind: "agent", command });
  for (const host of HOSTS) {
    for (const placement of ["split", "tab"] as Placement[]) out.push({ id: `launch:${host}:${placement}`, label: `Launch ${host} (${placement})`, kind: "launch", host, placement });
  }
  const scripts = ws ? workspaceScripts(ws.files) : {};
  for (const script of SCRIPT_ALLOWLIST) if (scripts[script]) out.push({ id: `script:${script}`, label: `npm run ${script}`, kind: "script", script });
  return out;
}

export function findAction(list: ActionDef[], id: string): ActionDef | undefined {
  return list.find((a) => a.id === id);
}

export async function runScript(root: string, script: string, run: Runner = defaultRun): Promise<{ ok: boolean; output: string }> {
  if (!SCRIPT_ALLOWLIST.includes(script)) return { ok: false, output: `script not allowed: ${script}` };
  const r = await run("npm", ["run", "--silent", script], { cwd: root, timeoutMs: 300_000 });
  const output = `${r.stdout}${r.stderr}`.trim() || r.error || "";
  return { ok: r.code === 0, output: output.slice(-4000) };
}

export function editorCommand(env: NodeJS.ProcessEnv, file: string): { cmd: string; args: string[] } {
  const [cmd, ...rest] = String(env.VISUAL || env.EDITOR || "vi").trim().split(/\s+/);
  return { cmd, args: [...rest, file] };
}
