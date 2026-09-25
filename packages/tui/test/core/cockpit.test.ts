import { test, expect } from "bun:test";
import { join } from "node:path";
import { Cockpit } from "../../src/core/cockpit";
import { DEFAULT_CONFIG } from "../../src/core/config";
import { makeFleetFixture } from "../helpers/fixtures";
import { fakeBackend, fakeHerdr, tick } from "../helpers/fakes";

function make(extra: Record<string, unknown> = {}) {
  const fx = makeFleetFixture();
  const notices: string[] = [];
  const cockpit = new Cockpit({
    frameworkRoot: fx.fw,
    invokedFrom: fx.instA,
    config: structuredClone(DEFAULT_CONFIG),
    env: {},
    now: () => new Date("2026-09-25T12:00:00Z"),
    git: false,
    watch: null,
    ...extra,
  } as any);
  cockpit.events.on("notice", (n) => notices.push(`${n.level}:${n.text}`));
  return { cockpit, notices, ...fx };
}

test("start picks the workspace containing the invocation path", async () => {
  const { cockpit } = make();
  await cockpit.start();
  const s = cockpit.snapshot();
  expect(s.activeId).toBe("inst-a");
  expect(s.activeName).toBe("Instance A");
  expect(s.fleet.map((r) => r.info.id)).toEqual(["hub", "fw", "inst-a", "ghost"]);
  expect(s.page?.title).toBe("Instance A");
  expect(s.loading).toBe(false);
  expect(s.agentAvailable).toBe(false);
  await cockpit.stop();
});

test("navigation: pages, back, and cross-workspace targets", async () => {
  const { cockpit } = make();
  await cockpit.start();
  await cockpit.dispatch({ type: "open-page", ref: { page: "tasks" } });
  expect(cockpit.snapshot().page?.title).toBe("Tasks");
  expect(cockpit.snapshot().canGoBack).toBe(true);
  await cockpit.dispatch({ type: "back" });
  expect(cockpit.snapshot().page?.title).toBe("Instance A");
  await cockpit.dispatch({ type: "open-page", ref: { page: "dashboard", workspace: "fw" } });
  expect(cockpit.snapshot().activeId).toBe("fw");
  await cockpit.dispatch({ type: "select-workspace", id: "ghost" });
  expect(cockpit.snapshot().page?.blocks[0]).toMatchObject({ kind: "notice", level: "warn" });
  await cockpit.stop();
});

test("lifecycle commands expand from .claude/commands and show as the slash form", async () => {
  const fb = fakeBackend();
  const { cockpit } = make({ backend: fb.backend });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "/close today" });
  await tick();
  expect(fb.prompts).toEqual(["Close the session for today now."]);
  expect(cockpit.snapshot().transcript[0]).toEqual({ kind: "user", text: "/close today" });
  expect(cockpit.snapshot().agentModel).toBe("faux/faux-1");
  await cockpit.stop();
});

test("permission requests surface, notify herdr, report blocked, and clear on answer", async () => {
  const fb = fakeBackend();
  const { herdr, calls } = fakeHerdr();
  const { cockpit, instA } = make({ backend: fb.backend, herdr, env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" } });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "hello" });
  await tick();
  const decision = fb.gate()!.check({ workspace: "inst-a", root: instA, tool: "write", input: { path: "x.md" } });
  await tick();
  const [req] = cockpit.snapshot().permissions;
  expect(req).toMatchObject({ tool: "write", summary: "x.md", workspace: "inst-a" });
  expect(calls).toContain("notify org-os: approval needed");
  expect(calls).toContain("report blocked");
  await cockpit.dispatch({ type: "permission-answer", id: req.id, answer: "once" });
  expect(await decision).toEqual({ allow: true });
  await tick();
  expect(cockpit.snapshot().permissions).toEqual([]);
  expect(calls.at(-1)).toBe("report idle");
  await cockpit.stop();
  expect(calls).toContain("release");
});

test("herdr agents appear on their workspace rows; hints load; enter focuses them", async () => {
  const { herdr, calls } = fakeHerdr();
  const fx = make({ herdr, env: { HERDR_ENV: "1" } });
  herdr.listAgents = async () => [{ paneId: "w1:p2", workspaceId: "w1", name: "a", agent: "claude", status: "working", cwd: join(fx.instA, "docs"), title: null }];
  await fx.cockpit.start();
  const s = fx.cockpit.snapshot();
  expect(s.fleet.find((r) => r.info.id === "inst-a")!.agents.length).toBe(1);
  expect(s.herdr).toEqual({ available: true, agents: 1 });
  await fx.cockpit.dispatch({ type: "open-page", ref: { page: "fleet" } });
  expect(fx.cockpit.snapshot().page!.blocks.some((b) => b.kind === "notice" && b.text.includes("install pi"))).toBe(true);
  await fx.cockpit.dispatch({ type: "open-page", ref: { page: "herdr-agent", id: "w1:p2" } });
  expect(calls).toContain("focus w1:p2");
  expect(fx.cockpit.snapshot().page!.title).toBe("Fleet");
  await fx.cockpit.stop();
});

test("actions: allow-listed scripts run, unknown ids refused, launch effects returned", async () => {
  const ran: string[] = [];
  const { cockpit, notices } = make({
    runScript: async (root: string, script: string) => {
      ran.push(`${root.split("/").pop()} ${script}`);
      return { ok: true, output: "done" };
    },
    launch: async () => ({ ok: true, strategy: "suspend", foreground: { type: "foreground", cmd: "claude", args: [], cwd: "/x" } }),
    launchEnv: { env: {}, platform: "linux", has: () => true, ghosttyInstalled: false },
  });
  await cockpit.start();
  await cockpit.dispatch({ type: "run-action", actionId: "script:initialize" });
  expect(ran).toEqual(["inst-a initialize"]);
  expect(notices.some((n) => n.startsWith("info:npm run initialize finished"))).toBe(true);
  await cockpit.dispatch({ type: "run-action", actionId: "script:deploy" });
  expect(notices.at(-1)).toContain("error:");
  const fx = await cockpit.dispatch({ type: "launch", host: "claude", placement: "split" });
  expect(fx).toEqual({ type: "foreground", cmd: "claude", args: [], cwd: "/x" });
  const open = await cockpit.dispatch({ type: "run-action", actionId: "open-source" });
  expect(open && open.type === "foreground" && open.args.at(-1)).toEndWith("HEARTBEAT.md");
  await cockpit.stop();
});

test("a backend that cannot open reports into the transcript", async () => {
  const fb = fakeBackend({ failOpen: true });
  const { cockpit } = make({ backend: fb.backend });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "hi" });
  await tick();
  const s = cockpit.snapshot();
  expect(s.transcript.at(-1)).toMatchObject({ kind: "notice", level: "error" });
  expect(s.agentStatus).toBe("error");
  await cockpit.stop();
});
