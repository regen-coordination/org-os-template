import { test, expect } from "bun:test";
import { join } from "node:path";
import { Cockpit } from "../../src/core/cockpit";
import { DEFAULT_CONFIG } from "../../src/core/config";
import { loadWorkspace as realLoadWorkspace } from "../../src/core/workspace";
import { makeFleetFixture } from "../helpers/fixtures";
import { fakeBackend, fakeHerdr, tick } from "../helpers/fakes";
import type { AgentBackend, AgentSession } from "../../src/core/agents/backend";

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

test("stop() while start() is still awaiting herdr setup never starts polling", async () => {
  let releaseIntegration: (() => void) | null = null;
  const integrationGate = new Promise<void>((r) => (releaseIntegration = r));
  const listAgentsCalls: number[] = [];
  const herdr: any = {
    listAgents: async () => {
      listAgentsCalls.push(1);
      return [];
    },
    integrationStatus: async () => {
      await integrationGate;
      return { pi: false, claude: true, opencode: true };
    },
    reportAgent: async () => {},
    releaseAgent: async () => {},
    reportTitle: async () => {},
    notify: async () => {},
    splitPane: async () => "w1:p9",
    runInPane: async () => {},
    focusAgent: async () => {},
  };
  const { cockpit } = make({ herdr, env: { HERDR_ENV: "1" } });
  const starting = cockpit.start();
  await tick();
  await cockpit.stop();
  releaseIntegration!();
  await starting;
  expect(listAgentsCalls.length).toBe(0);
  await tick();
  expect(listAgentsCalls.length).toBe(0);
});

test("stop() during the initial workspace load never opens a watcher afterward", async () => {
  let releaseLoad: (() => void) | null = null;
  const loadGate = new Promise<void>((r) => (releaseLoad = r));
  const opens: string[] = [];
  const closes: string[] = [];
  const { cockpit } = make({
    watch: (root: string) => {
      opens.push(root);
      return () => closes.push(root);
    },
    loadWorkspace: async (info: any, opts: any) => {
      if (info.id === "inst-a") await loadGate;
      return realLoadWorkspace(info, opts);
    },
  });
  const starting = cockpit.start();
  await tick();
  await cockpit.stop();
  releaseLoad!();
  await starting;
  expect(opens.length).toBe(0);
  expect(opens.length).toBe(closes.length);
});

test("stop() disposes a session whose backend.open resolves after stop", async () => {
  let releaseOpen: ((s: AgentSession) => void) | null = null;
  const disposed: string[] = [];
  const backend: AgentBackend = {
    id: "pi",
    available: async () => ({ ok: true }),
    open: () =>
      new Promise<AgentSession>((resolve) => {
        releaseOpen = (s) => resolve(s);
      }),
  };
  const { cockpit } = make({ backend });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "hi" });
  await tick();
  await cockpit.stop();
  const session: AgentSession = {
    id: "s1",
    backend: "pi",
    model: "faux/faux-1",
    async prompt() {},
    async abort() {},
    subscribe() {
      return () => {};
    },
    async dispose() {
      disposed.push("s1");
    },
  };
  releaseOpen!(session);
  await tick();
  expect(disposed).toEqual(["s1"]);
});

test("agent-new-session denies the old session's pending approvals instead of leaking them", async () => {
  const fb = fakeBackend();
  const { herdr, calls } = fakeHerdr();
  const { cockpit, instA } = make({ backend: fb.backend, herdr, env: { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" } });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "hello" });
  await tick();
  const decision = fb.gate()!.check({ workspace: "inst-a", root: instA, tool: "write", input: { path: "x.md" } });
  await tick();
  expect(cockpit.snapshot().permissions.length).toBe(1);
  await cockpit.dispatch({ type: "agent-new-session" });
  expect(await decision).toEqual({ allow: false, reason: "denied by the operator" });
  expect(cockpit.snapshot().permissions).toEqual([]);
  expect(calls).toContain("report idle");
  // a fresh check for the same tool asks again — the old pending "session" answer never lands on the new session
  const decision2 = fb.gate()!.check({ workspace: "inst-a", root: instA, tool: "write", input: { path: "y.md" } });
  await tick();
  expect(cockpit.snapshot().permissions.length).toBe(1);
  await cockpit.dispatch({ type: "permission-answer", id: cockpit.snapshot().permissions[0].id, answer: "deny" });
  expect(await decision2).toEqual({ allow: false, reason: "denied by the operator" });
  await cockpit.stop();
});

test("a session.prompt rejection does not crash the process and surfaces an error notice", async () => {
  const backend: AgentBackend = {
    id: "pi",
    available: async () => ({ ok: true }),
    open: async () => ({
      id: "s1",
      backend: "pi",
      model: "faux/faux-1",
      async prompt() {
        throw new Error("boom");
      },
      async abort() {},
      subscribe() {
        return () => {};
      },
      async dispose() {},
    }),
  };
  const { cockpit, notices } = make({ backend });
  await cockpit.start();
  await cockpit.dispatch({ type: "agent-prompt", text: "hi" });
  await tick();
  expect(notices.some((n) => n.startsWith("error:") && n.includes("boom"))).toBe(true);
  await cockpit.stop();
});

test("notices emitted before anyone subscribes (config errors, the latched herdr warning) reach the first subscriber", async () => {
  const fx = makeFleetFixture();
  const herdr: any = { ...fakeHerdr().herdr, listAgents: async () => { throw new Error("socket gone"); } };
  const cockpit = new Cockpit({
    frameworkRoot: fx.fw,
    invokedFrom: fx.instA,
    config: structuredClone(DEFAULT_CONFIG),
    env: { HERDR_ENV: "1" },
    git: false,
    watch: null,
    herdr,
  } as any);
  cockpit.notice("warn", "config.json: Unexpected token");
  await cockpit.start();
  const got: string[] = [];
  cockpit.events.on("notice", (n) => got.push(`${n.level}:${n.text}`));
  expect(got[0]).toBe("warn:config.json: Unexpected token");
  expect(got).toContain("warn:herdr unavailable: socket gone");
  cockpit.notice("info", "later");
  expect(got.at(-1)).toBe("info:later");
  await cockpit.stop();
});

test("activateInitial shows the active page before the rest of the fleet loads in the background", async () => {
  let releaseRest: (() => void) | null = null;
  const restGate = new Promise<void>((r) => (releaseRest = r));
  const { cockpit } = make({
    loadWorkspace: async (info: any, opts: any) => {
      if (info.id !== "inst-a") await restGate;
      return realLoadWorkspace(info, opts);
    },
  });
  await cockpit.activateInitial();
  let s = cockpit.snapshot();
  expect(s.activeId).toBe("inst-a");
  expect(s.page?.title).toBe("Instance A");
  expect(s.loading).toBe(true);
  expect(s.fleet.find((r) => r.info.id === "hub")!.summary).toBe(null);
  const rest = cockpit.loadRest();
  await tick();
  expect(cockpit.snapshot().loading).toBe(true);
  releaseRest!();
  await rest;
  s = cockpit.snapshot();
  expect(s.loading).toBe(false);
  expect(s.fleet.every((r) => r.summary !== null)).toBe(true);
  await cockpit.stop();
});

test("one workspace failing to load does not stall the background load", async () => {
  const { cockpit, notices } = make({
    loadWorkspace: async (info: any, opts: any) => {
      if (info.id === "hub") throw new Error("EACCES");
      return realLoadWorkspace(info, opts);
    },
  });
  await cockpit.start();
  expect(cockpit.snapshot().loading).toBe(false);
  expect(cockpit.snapshot().fleet.find((r) => r.info.id === "fw")!.summary).not.toBe(null);
  expect(notices.some((n) => n.startsWith("warn:") && n.includes("EACCES"))).toBe(true);
  await cockpit.stop();
});

test("a throwing listener becomes an error notice; a throwing notice listener cannot recurse", async () => {
  const { cockpit, notices } = make();
  let noticeCalls = 0;
  cockpit.events.on("state", () => {
    throw new Error("bad state listener");
  });
  cockpit.events.on("notice", () => {
    noticeCalls++;
    throw new Error("bad notice listener");
  });
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    await cockpit.start();
    await tick();
  } finally {
    console.error = original;
  }
  expect(notices.some((n) => n.startsWith("error:") && n.includes("bad state listener"))).toBe(true);
  expect(noticeCalls).toBe(notices.length);
  expect(logged).toEqual([]);
  await cockpit.stop();
});

test("the agent-pane toggle and the last workspace persist together through saveUiState", async () => {
  const saved: unknown[] = [];
  const { cockpit } = make({ uiState: { agentOpen: true }, saveUiState: (s: unknown) => saved.push(s) });
  await cockpit.start();
  expect(saved.at(-1)).toEqual({ agentOpen: true, lastWorkspace: "inst-a" });
  await cockpit.dispatch({ type: "set-agent-open", open: false });
  expect(saved.at(-1)).toEqual({ agentOpen: false, lastWorkspace: "inst-a" });
  await cockpit.dispatch({ type: "select-workspace", id: "fw" });
  expect(saved.at(-1)).toEqual({ agentOpen: false, lastWorkspace: "fw" });
  await cockpit.stop();
});
