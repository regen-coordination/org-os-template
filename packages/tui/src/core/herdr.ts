// herdr (terminal workspace manager for coding agents) over its CLI, which
// answers JSON envelopes { id, result: { type, ... } } — shapes from
// `herdr api schema` (protocol 22). Only used when the cockpit runs inside a
// herdr pane (HERDR_ENV=1); never probes a session from outside.
import type { Runner } from "./proc";
import { HOSTS, type HerdrAgent, type WorkspaceInfo } from "./types";
import { containsPath } from "./util";

export const HERDR_SOURCE = "org-os-cockpit";

export class HerdrError extends Error {
  constructor(message: string, readonly args: string[]) {
    super(message);
    this.name = "HerdrError";
  }
}

export const inHerdr = (env: NodeJS.ProcessEnv) => env.HERDR_ENV === "1";
export const herdrBin = (env: NodeJS.ProcessEnv) => env.HERDR_BIN_PATH || "herdr";

export function normalizeStatus(s: unknown): string {
  if (typeof s === "string") return s;
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    if (typeof o.state === "string") return o.state;
    if (typeof o.status === "string") return o.status;
  }
  return "unknown";
}

export function toHerdrAgent(a: any): HerdrAgent {
  return {
    paneId: String(a?.pane_id ?? ""),
    workspaceId: String(a?.workspace_id ?? ""),
    name: a?.name ?? null,
    agent: a?.agent ?? a?.display_agent ?? null,
    status: normalizeStatus(a?.agent_status),
    cwd: a?.cwd ?? a?.foreground_cwd ?? null,
    title: a?.title ?? null,
  };
}

export function parseIntegrationStatus(text: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([\w-]+)(?: \([^)]*\))?:\s*(not installed|installed)/);
    if (m) out[m[1]] = m[2] === "installed";
  }
  return out;
}

export function integrationHints(status: Record<string, boolean>): string[] {
  return HOSTS.filter((h) => status[h] === false).map(
    (h) => `herdr can't read ${h}'s state yet — run \`herdr integration install ${h}\` (operator action)`,
  );
}

export function mapAgentsToWorkspaces(agents: HerdrAgent[], fleet: WorkspaceInfo[]): Record<string, HerdrAgent[]> {
  const out: Record<string, HerdrAgent[]> = {};
  for (const agent of agents) {
    if (!agent.cwd) continue;
    const ws = fleet.filter((w) => containsPath(w.root, agent.cwd!)).sort((a, b) => b.root.length - a.root.length)[0];
    if (ws) (out[ws.id] ??= []).push(agent);
  }
  return out;
}

function errorText(stderr: string, fallback: string): string {
  try {
    const parsed = JSON.parse(stderr);
    return parsed?.error?.message ?? parsed?.message ?? stderr.trim();
  } catch {
    return stderr.trim() || fallback;
  }
}

export class HerdrClient {
  constructor(private deps: { run: Runner; bin: string; timeoutMs?: number }) {}

  async call(args: string[], timeoutMs?: number): Promise<any> {
    const r = await this.deps.run(this.deps.bin, args, { timeoutMs: timeoutMs ?? this.deps.timeoutMs ?? 5000 });
    if (r.code !== 0) throw new HerdrError(errorText(r.stderr, r.error ?? `herdr ${args.join(" ")} failed`), args);
    const text = r.stdout.trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      return parsed?.result ?? parsed;
    } catch {
      return text;
    }
  }

  async listAgents(): Promise<HerdrAgent[]> {
    const res = await this.call(["agent", "list"]);
    return Array.isArray(res?.agents) ? res.agents.map(toHerdrAgent) : [];
  }

  async splitPane(o: { cwd: string; direction: "right" | "down" }): Promise<string> {
    const args = ["pane", "split", "--current", "--direction", o.direction, "--cwd", o.cwd, "--no-focus"];
    const id = (await this.call(args))?.pane?.pane_id;
    if (!id) throw new HerdrError("herdr pane split returned no pane id", args);
    return id;
  }

  async createTab(o: { cwd: string; label: string }): Promise<string> {
    const args = ["tab", "create", "--cwd", o.cwd, "--label", o.label, "--focus"];
    const id = (await this.call(args))?.root_pane?.pane_id;
    if (!id) throw new HerdrError("herdr tab create returned no pane id", args);
    return id;
  }

  async startAgent(o: { name: string; kind: string; paneId: string }): Promise<void> {
    await this.call(["agent", "start", o.name, "--kind", o.kind, "--pane", o.paneId], 45_000);
  }

  async closePane(paneId: string): Promise<void> {
    await this.call(["pane", "close", paneId]);
  }

  async runInPane(paneId: string, command: string): Promise<void> {
    await this.call(["pane", "run", paneId, command]);
  }

  async focusAgent(target: string): Promise<void> {
    await this.call(["agent", "focus", target]);
  }

  async reportAgent(o: { paneId: string; state: "idle" | "working" | "blocked" | "unknown"; seq: number; message?: string }): Promise<void> {
    const args = ["pane", "report-agent", o.paneId, "--source", HERDR_SOURCE, "--agent", "pi", "--state", o.state, "--seq", String(o.seq)];
    if (o.message) args.push("--message", o.message);
    await this.call(args);
  }

  async releaseAgent(o: { paneId: string; seq: number }): Promise<void> {
    await this.call(["pane", "release-agent", o.paneId, "--source", HERDR_SOURCE, "--agent", "pi", "--seq", String(o.seq)]);
  }

  async reportTitle(o: { paneId: string; title: string }): Promise<void> {
    await this.call(["pane", "report-metadata", o.paneId, "--source", HERDR_SOURCE, "--title", o.title]);
  }

  async notify(o: { title: string; body?: string; sound?: "none" | "done" | "request" }): Promise<void> {
    await this.call(["notification", "show", o.title, ...(o.body ? ["--body", o.body] : []), "--sound", o.sound ?? "request"]);
  }

  async integrationStatus(): Promise<Record<string, boolean>> {
    const r = await this.deps.run(this.deps.bin, ["integration", "status"], { timeoutMs: 5000 });
    if (r.code !== 0) throw new HerdrError(r.stderr.trim() || "herdr integration status failed", ["integration", "status"]);
    return parseIntegrationStatus(r.stdout);
  }
}
