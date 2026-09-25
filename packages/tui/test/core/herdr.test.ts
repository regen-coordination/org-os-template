import { test, expect } from "bun:test";
import { HerdrClient, HerdrError, inHerdr, herdrBin, mapAgentsToWorkspaces, normalizeStatus, parseIntegrationStatus, integrationHints, toHerdrAgent } from "../../src/core/herdr";
import type { ProcResult, Runner } from "../../src/core/proc";
import type { WorkspaceInfo } from "../../src/core/types";

function fake(responses: Record<string, ProcResult>) {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = args.slice(0, 2).join(" ");
    return responses[key] ?? { code: 0, stdout: JSON.stringify({ id: "1", result: { type: "ok" } }), stderr: "" };
  };
  return { calls, client: new HerdrClient({ run, bin: "/bin/herdr" }) };
}
const ok = (result: unknown): ProcResult => ({ code: 0, stdout: JSON.stringify({ id: "1", result }), stderr: "" });

test("env helpers", () => {
  expect(inHerdr({ HERDR_ENV: "1" })).toBe(true);
  expect(inHerdr({})).toBe(false);
  expect(herdrBin({ HERDR_BIN_PATH: "/x/herdr" })).toBe("/x/herdr");
  expect(herdrBin({})).toBe("herdr");
});

test("listAgents unwraps the envelope and normalizes", async () => {
  const { client, calls } = fake({
    "agent list": ok({ type: "agent_list", agents: [{ pane_id: "w1:p2", workspace_id: "w1", name: "rev", agent: "claude", agent_status: "working", cwd: "/a/b", title: "t" }, { pane_id: "w1:p3", workspace_id: "w1", agent: null, display_agent: "pi", agent_status: { state: "idle" }, foreground_cwd: "/c" }] }),
  });
  const agents = await client.listAgents();
  expect(calls[0]).toEqual(["/bin/herdr", "agent", "list"]);
  expect(agents).toEqual([
    { paneId: "w1:p2", workspaceId: "w1", name: "rev", agent: "claude", status: "working", cwd: "/a/b", title: "t" },
    { paneId: "w1:p3", workspaceId: "w1", name: null, agent: "pi", status: "idle", cwd: "/c", title: null },
  ]);
});

test("pane/tab/agent commands build the documented argv", async () => {
  const { client, calls } = fake({
    "pane split": ok({ type: "pane_info", pane: { pane_id: "w1:p9" } }),
    "tab create": ok({ type: "tab_created", tab: { tab_id: "w1:t2" }, root_pane: { pane_id: "w1:p10" } }),
  });
  expect(await client.splitPane({ cwd: "/ws", direction: "right" })).toBe("w1:p9");
  expect(await client.createTab({ cwd: "/ws", label: "ws:claude" })).toBe("w1:p10");
  await client.startAgent({ name: "ws-claude", kind: "claude", paneId: "w1:p9" });
  await client.reportAgent({ paneId: "w1:p1", state: "working", seq: 3 });
  await client.releaseAgent({ paneId: "w1:p1", seq: 4 });
  await client.reportTitle({ paneId: "w1:p1", title: "org-os · Hub" });
  await client.notify({ title: "org-os: approval needed", body: "write in hub" });
  await client.runInPane("w1:p9", "vi /f");
  await client.closePane("w1:p9");
  await client.focusAgent("w1:p2");
  expect(calls.map((c) => c.slice(1))).toEqual([
    ["pane", "split", "--current", "--direction", "right", "--cwd", "/ws", "--no-focus"],
    ["tab", "create", "--cwd", "/ws", "--label", "ws:claude", "--focus"],
    ["agent", "start", "ws-claude", "--kind", "claude", "--pane", "w1:p9"],
    ["pane", "report-agent", "w1:p1", "--source", "org-os-cockpit", "--agent", "pi", "--state", "working", "--seq", "3"],
    ["pane", "release-agent", "w1:p1", "--source", "org-os-cockpit", "--agent", "pi", "--seq", "4"],
    ["pane", "report-metadata", "w1:p1", "--source", "org-os-cockpit", "--title", "org-os · Hub"],
    ["notification", "show", "org-os: approval needed", "--body", "write in hub", "--sound", "request"],
    ["pane", "run", "w1:p9", "vi /f"],
    ["pane", "close", "w1:p9"],
    ["agent", "focus", "w1:p2"],
  ]);
});

test("CLI errors become HerdrError; missing ids too", async () => {
  const { client } = fake({ "agent list": { code: 1, stdout: "", stderr: '{"error":{"code":"no_session","message":"no server"}}' }, "pane split": ok({ type: "pane_info" }) });
  await expect(client.listAgents()).rejects.toBeInstanceOf(HerdrError);
  await expect(client.listAgents()).rejects.toThrow("no server");
  await expect(client.splitPane({ cwd: "/", direction: "down" })).rejects.toThrow("no pane id");
});

test("integration status parsing and hints", () => {
  const st = parseIntegrationStatus("pi: not installed (/x)\nclaude: installed (/y)\nopencode: not installed (/z)\ncodex: not installed (/w)\n");
  expect(st).toEqual({ pi: false, claude: true, opencode: false, codex: false });
  expect(integrationHints(st)).toEqual([
    "herdr can't read pi's state yet — run `herdr integration install pi` (operator action)",
    "herdr can't read opencode's state yet — run `herdr integration install opencode` (operator action)",
  ]);
});

test("agents map to the deepest containing workspace", () => {
  const fleet = [
    { id: "hub", root: "/v" },
    { id: "fw", root: "/v/libs/fw" },
  ] as WorkspaceInfo[];
  const map = mapAgentsToWorkspaces([
    toHerdrAgent({ pane_id: "a", workspace_id: "w", cwd: "/v/libs/fw/packages", agent_status: "idle" }),
    toHerdrAgent({ pane_id: "b", workspace_id: "w", cwd: "/v/notes", agent_status: "done" }),
    toHerdrAgent({ pane_id: "c", workspace_id: "w", cwd: "/elsewhere", agent_status: "idle" }),
  ], fleet);
  expect(map.fw.map((a) => a.paneId)).toEqual(["a"]);
  expect(map.hub.map((a) => a.paneId)).toEqual(["b"]);
  expect(normalizeStatus(undefined)).toBe("unknown");
});
