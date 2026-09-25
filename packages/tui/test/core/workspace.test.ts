import { test, expect } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkspace, parseGitStatus, readGitStatus, summarize, watchWorkspace } from "../../src/core/workspace";
import { discoverFleet } from "../../src/core/fleet";
import { makeFleetFixture } from "../helpers/fixtures";
import type { Runner } from "../../src/core/proc";

const NOW = new Date("2026-09-25T12:00:00Z");

test("parseGitStatus", () => {
  expect(parseGitStatus("## main...origin/main [ahead 2, behind 1]\n M a.md\n?? b.md\n")).toEqual({ branch: "main", dirty: true, ahead: 2, behind: 1 });
  expect(parseGitStatus("## feat/x\n")).toEqual({ branch: "feat/x", dirty: false, ahead: 0, behind: 0 });
  expect(parseGitStatus("## No commits yet on main\n").branch).toBe("main");
  expect(parseGitStatus("## HEAD (no branch)\n").branch).toBe("HEAD");
});

test("readGitStatus uses read-only git with optional locks off", async () => {
  const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const run: Runner = async (_cmd, args, opts) => {
    calls.push({ args, env: opts?.env });
    if (args.includes("status")) return { code: 0, stdout: "## main\n M x\n", stderr: "" };
    return { code: 0, stdout: "3 hours ago\n", stderr: "" };
  };
  expect(await readGitStatus("/r", run)).toEqual({ branch: "main", dirty: true, ahead: 0, behind: 0, lastCommit: "3 hours ago" });
  expect(calls[0].args).toEqual(["-C", "/r", "status", "--porcelain=v1", "--branch"]);
  expect(calls[0].env?.GIT_OPTIONAL_LOCKS).toBe("0");
  const failing: Runner = async () => ({ code: 128, stdout: "", stderr: "not a repo" });
  expect(await readGitStatus("/r", failing)).toBe(null);
});

test("loadWorkspace + summarize on a real fixture", async () => {
  const { fw } = makeFleetFixture();
  const { fleet } = discoverFleet(fw, { workspaces: [] });
  const inst = fleet.find((w) => w.id === "inst-a")!;
  const ws = await loadWorkspace(inst, { now: NOW, git: false });
  expect(ws.errors).toEqual([]);
  expect(ws.state.identity.name).toBe("Instance A");
  const s = summarize(ws);
  expect(s).toMatchObject({ id: "inst-a", name: "Instance A", type: "LocalNode", openTasks: 2, lastMemory: "2026-09-24" });
  expect(s.urgentTasks).toBe(2);
});

test("a missing workspace loads as an error, not a throw", async () => {
  const { fw } = makeFleetFixture();
  const ghost = discoverFleet(fw, { workspaces: [] }).fleet.find((w) => w.id === "ghost")!;
  const ws = await loadWorkspace(ghost, { now: NOW, git: false });
  expect(ws.state).toBe(null);
  expect(ws.errors[0]).toContain("missing");
  expect(summarize(ws)).toMatchObject({ openTasks: 0, name: "ghost" });
});

test("watcher debounces changes", async () => {
  const { instA } = makeFleetFixture();
  let calls = 0;
  const stop = watchWorkspace(instA, () => calls++, { debounceMs: 200 });
  await new Promise((r) => setTimeout(r, 150)); // let the FSEvents stream go live before writing (macOS)
  writeFileSync(join(instA, "HEARTBEAT.md"), "# changed\n");
  writeFileSync(join(instA, "memory", "2026-09-25.md"), "# new\n");
  await new Promise((r) => setTimeout(r, 800));
  stop();
  expect(calls).toBe(1);
});
