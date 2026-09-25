import { test, expect } from "bun:test";
import { discoverFleet } from "../../src/core/fleet";
import { loadWorkspace, summarize } from "../../src/core/workspace";
import { resolvePage, PAGE_INDEX, sourceFor, type PageContext } from "../../src/core/pages";
import { makeFleetFixture } from "../helpers/fixtures";

const NOW = new Date("2026-09-25T12:00:00Z");

async function ctxFor(id: string): Promise<PageContext> {
  const { fw } = makeFleetFixture();
  const { fleet } = discoverFleet(fw, { workspaces: [] });
  const loaded = await Promise.all(fleet.map((w) => loadWorkspace(w, { now: NOW, git: false })));
  const ws = loaded.find((l) => l.info.id === id)!;
  return {
    ws,
    fleet: loaded.map((l) => ({ info: l.info, summary: summarize(l), agents: l.info.id === "inst-a" ? [{ paneId: "w1:p1", workspaceId: "w1", name: "a-pi", agent: "pi", status: "working", cwd: l.info.root, title: null }] : [] })),
    now: NOW,
    hints: ["herdr integration for pi is not installed"],
  };
}

test("every indexed page resolves without errors on a full workspace", async () => {
  const ctx = await ctxFor("inst-a");
  for (const { page } of PAGE_INDEX) {
    const p = resolvePage({ page }, ctx);
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.blocks.length).toBeGreaterThan(0);
  }
});

test("fleet page rows target dashboards and show agents, missing rows and hints", async () => {
  const ctx = await ctxFor("inst-a");
  const p = resolvePage({ page: "fleet" }, ctx);
  const table = p.blocks.find((b) => b.kind === "table")!;
  if (table.kind !== "table") throw new Error("expected table");
  const inst = table.rows.find((r) => r.key === "inst-a")!;
  expect(inst.target).toEqual({ page: "dashboard", workspace: "inst-a" });
  expect(inst.cells.join(" ")).toContain("pi:working");
  expect(table.rows.find((r) => r.key === "ghost")!.cells[0]).toContain("missing");
  expect(p.blocks.some((b) => b.kind === "notice" && b.text.includes("herdr integration"))).toBe(true);
  const agents = p.blocks.find((b) => b.kind === "list" && b.heading === "herdr agents");
  expect(agents && agents.kind === "list" && agents.items[0].target).toEqual({ page: "herdr-agent", id: "w1:p1" });
});

test("dashboard, tasks, decisions, memory drill-downs", async () => {
  const ctx = await ctxFor("inst-a");
  const dash = resolvePage({ page: "dashboard" }, ctx);
  expect(dash.title).toBe("Instance A");
  const urgent = dash.blocks.find((b) => b.kind === "list" && b.heading === "Urgent");
  expect(urgent && urgent.kind === "list" && urgent.items.length).toBe(2);
  const projects = dash.blocks.find((b) => b.kind === "table" && b.heading === "Projects");
  expect(projects && projects.kind === "table" && projects.rows[0].target).toEqual({ page: "project", id: "cockpit" });
  expect(resolvePage({ page: "project", id: "cockpit" }, ctx).title).toBe("Cockpit");
  const decisions = resolvePage({ page: "decisions" }, ctx);
  const drow = decisions.blocks[0];
  expect(drow.kind === "table" && drow.rows[0].target).toEqual({ page: "decision", id: "1" });
  const d1 = resolvePage({ page: "decision", id: "1" }, ctx);
  expect(d1.blocks[0]).toMatchObject({ kind: "markdown" });
  expect(resolvePage({ page: "memory", id: "2026-09-24" }, ctx).blocks[0]).toMatchObject({ kind: "markdown" });
  expect(sourceFor({ page: "tasks" }, ctx.ws)).toEndWith("HEARTBEAT.md");
  expect(sourceFor({ page: "memory", id: "2026-09-24" }, ctx.ws)).toEndWith("memory/2026-09-24.md");
});

test("empty or missing workspaces render notices, unknown pages and ids too", async () => {
  const ctx = await ctxFor("fw");
  for (const page of ["tasks", "decisions", "memory", "plans", "this-week"]) {
    const p = resolvePage({ page }, ctx);
    expect(p.blocks.some((b) => b.kind === "notice")).toBe(true);
  }
  const ghost = await ctxFor("ghost");
  expect(resolvePage({ page: "dashboard" }, ghost).blocks[0]).toMatchObject({ kind: "notice", level: "warn" });
  expect(resolvePage({ page: "nope" }, ctx).blocks[0]).toMatchObject({ kind: "notice", level: "error" });
  expect(resolvePage({ page: "project", id: "nope" }, ctx).blocks[0]).toMatchObject({ kind: "notice" });
});

test("Object.prototype names are unknown pages, not resolvers or sources", async () => {
  const ctx = await ctxFor("inst-a");
  for (const page of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    const p = resolvePage({ page }, ctx);
    expect(p.title).toBe("Unknown page");
    expect(p.blocks[0]).toMatchObject({ kind: "notice", level: "error" });
    expect(sourceFor({ page }, ctx.ws)).toBe(null);
  }
});

test("an empty this-week page says so in this week's terms", async () => {
  const ctx = await ctxFor("fw");
  const p = resolvePage({ page: "this-week" }, ctx);
  expect(p.blocks).toEqual([{ kind: "notice", level: "info", text: "Nothing dated this week." }]);
});
