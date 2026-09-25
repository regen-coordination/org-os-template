import { test, expect } from "bun:test";
import { agentName, launchHost, viableStrategies, type LaunchEnv } from "../../src/core/launch";
import type { Runner } from "../../src/core/proc";

const le = (env: Record<string, string>, extra: Partial<LaunchEnv> = {}): LaunchEnv => ({
  env,
  platform: "darwin",
  has: (b) => ["herdr", "tmux", "claude", "pi", "open"].includes(b),
  ghosttyInstalled: true,
  ...extra,
});

test("strategy selection", () => {
  expect(viableStrategies(le({ HERDR_ENV: "1", TMUX: "x" }))).toEqual(["herdr", "tmux", "ghostty", "suspend"]);
  expect(viableStrategies(le({}))).toEqual(["ghostty", "suspend"]);
  expect(viableStrategies(le({ TMUX: "x" }), "suspend")).toEqual(["suspend", "tmux", "ghostty"]);
  expect(viableStrategies(le({}), "herdr")).toEqual(["ghostty", "suspend"]);
  expect(viableStrategies(le({}, { platform: "linux" }))).toEqual(["suspend"]);
});

test("agent names are valid for herdr and unique", () => {
  expect(agentName("refi-bcn-os", "claude", [])).toBe("refi-bcn-os-claude");
  expect(agentName("refi-bcn-os", "claude", ["refi-bcn-os-claude"])).toBe("refi-bcn-os-claude-2");
  expect(agentName("2026-hub", "pi", [])).toBe("a-2026-hub-pi");
  expect(agentName("x".repeat(60), "opencode", []).length).toBeLessThanOrEqual(32);
});

function fakeHerdr(fail = false) {
  const calls: string[] = [];
  return {
    calls,
    herdr: {
      async splitPane(o: any) { calls.push(`split ${o.direction} ${o.cwd}`); return "w1:p9"; },
      async createTab(o: any) { calls.push(`tab ${o.label}`); return "w1:p10"; },
      async startAgent(o: any) { calls.push(`start ${o.name} ${o.kind} ${o.paneId}`); if (fail) throw new Error("agent_not_ready"); },
      async closePane(id: string) { calls.push(`close ${id}`); },
    } as any,
  };
}
const req = { host: "claude" as const, placement: "split" as const, cwd: "/ws", wsId: "hub", paneCols: 160, takenNames: [] };

test("herdr split: direction by width, agent started", async () => {
  const { herdr, calls } = fakeHerdr();
  const noRun: Runner = async () => { throw new Error("should not run"); };
  const out = await launchHost(req, { le: le({ HERDR_ENV: "1" }), strategies: ["herdr", "suspend"], run: noRun, herdr });
  expect(out).toEqual({ ok: true, strategy: "herdr", detail: "herdr split w1:p9 (hub-claude)" });
  expect(calls).toEqual(["split right /ws", "start hub-claude claude w1:p9"]);
  await launchHost({ ...req, paneCols: 90 }, { le: le({ HERDR_ENV: "1" }), strategies: ["herdr"], run: noRun, herdr });
  expect(calls[2]).toBe("split down /ws");
});

test("a failed herdr start closes its pane and falls through", async () => {
  const { herdr, calls } = fakeHerdr(true);
  const out = await launchHost({ ...req, placement: "tab" }, { le: le({ HERDR_ENV: "1" }), strategies: ["herdr", "suspend"], run: async () => ({ code: 0, stdout: "", stderr: "" }), herdr });
  expect(calls).toEqual(["tab hub:claude", "start hub-claude claude w1:p10", "close w1:p10"]);
  expect(out).toEqual({ ok: true, strategy: "suspend", foreground: { type: "foreground", cmd: "claude", args: [], cwd: "/ws" } });
});

test("tmux and ghostty argv; missing host fails fast", async () => {
  const seen: string[][] = [];
  const run: Runner = async (cmd, args) => { seen.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; };
  await launchHost(req, { le: le({ TMUX: "x" }), strategies: ["tmux"], run, herdr: null });
  await launchHost({ ...req, placement: "tab" }, { le: le({ TMUX: "x" }), strategies: ["tmux"], run, herdr: null });
  await launchHost({ ...req, host: "pi" }, { le: le({}), strategies: ["ghostty"], run, herdr: null });
  expect(seen).toEqual([
    ["tmux", "split-window", "-h", "-c", "/ws", "claude"],
    ["tmux", "new-window", "-c", "/ws", "claude"],
    ["open", "-na", "Ghostty.app", "--args", "--working-directory=/ws", "-e", "pi"],
  ]);
  const missing = await launchHost({ ...req, host: "opencode" }, { le: le({}), strategies: ["suspend"], run, herdr: null });
  expect(missing).toEqual({ ok: false, error: "opencode is not installed (not on PATH)", tried: [] });
});

test("every strategy failing reports all errors", async () => {
  const run: Runner = async () => ({ code: 1, stdout: "", stderr: "no server" });
  const out = await launchHost(req, { le: le({ TMUX: "x" }), strategies: ["tmux", "ghostty"], run, herdr: null });
  expect(out.ok).toBe(false);
  if (!out.ok) {
    expect(out.tried).toEqual(["tmux", "ghostty"]);
    expect(out.error).toContain("tmux: no server");
  }
});
