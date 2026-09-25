import { test, expect } from "bun:test";
import { Gate, summarizeTool } from "../../src/core/gate";
import type { PermissionRequest } from "../../src/core/types";

const DANGEROUS = ["git", "stash", "list"].join(" ");
const base = { workspace: "ws", root: "/tmp" };

function makeGate(opts: { guardAllow?: boolean; timeoutMs?: number } = {}) {
  const asked: PermissionRequest[] = [];
  let n = 0;
  const gate = new Gate({
    ask: (r) => asked.push(r),
    guard: (cmd) => (opts.guardAllow === false || cmd.includes("stash") ? { allow: false, reason: "BLOCKED by guard" } : { allow: true }),
    timeoutMs: opts.timeoutMs,
    newId: () => `p${++n}`,
  });
  return { gate, asked };
}

test("guard block beats everything, including a session allowance", async () => {
  const { gate, asked } = makeGate();
  const first = gate.check({ ...base, tool: "bash", input: { command: "ls" } });
  gate.answer("p1", "session");
  expect(await first).toEqual({ allow: true });
  expect(await gate.check({ ...base, tool: "bash", input: { command: DANGEROUS } })).toEqual({ allow: false, reason: "BLOCKED by guard" });
  expect(asked.length).toBe(1);
});

test("read-only tools pass without asking; mutating tools ask", async () => {
  const { gate, asked } = makeGate();
  expect(await gate.check({ ...base, tool: "read", input: { path: "a" } })).toEqual({ allow: true });
  const pending = gate.check({ ...base, tool: "write", input: { path: "a.md", content: "x" } });
  expect(asked[0]).toMatchObject({ id: "p1", tool: "write", summary: "a.md", workspace: "ws" });
  expect(gate.pending().map((p) => p.id)).toEqual(["p1"]);
  gate.answer("p1", "once");
  expect(await pending).toEqual({ allow: true });
  const again = gate.check({ ...base, tool: "write", input: { path: "b.md" } });
  expect(asked.length).toBe(2);
  gate.answer("p2", "deny");
  expect(await again).toEqual({ allow: false, reason: "denied by the operator" });
});

test("session allowance is per workspace and per tool", async () => {
  const { gate, asked } = makeGate();
  const p = gate.check({ ...base, tool: "edit", input: {} });
  gate.answer("p1", "session");
  await p;
  expect(await gate.check({ ...base, tool: "edit", input: {} })).toEqual({ allow: true });
  const other = gate.check({ workspace: "other", root: "/tmp", tool: "edit", input: {} });
  expect(asked.length).toBe(2);
  gate.answer("p2", "once");
  await other;
  gate.resetSession("ws");
  gate.check({ ...base, tool: "edit", input: {} });
  expect(asked.length).toBe(3);
  gate.cancelAll("test done");
});

test("concurrent requests resolve by id", async () => {
  const { gate } = makeGate();
  const a = gate.check({ ...base, tool: "write", input: { path: "a" } });
  const b = gate.check({ ...base, tool: "write", input: { path: "b" } });
  expect(gate.answer("p2", "once")).toBe(true);
  expect(gate.answer("p1", "deny")).toBe(true);
  expect(gate.answer("p1", "once")).toBe(false);
  expect(await b).toEqual({ allow: true });
  expect((await a).allow).toBe(false);
});

test("unanswered requests time out as deny; cancelAll denies the rest; onSettle fires", async () => {
  const settled: string[] = [];
  const timed = new Gate({ ask: () => {}, guard: () => ({ allow: true }), timeoutMs: 30, newId: () => "t1", onSettle: (id) => settled.push(id) });
  expect(await timed.check({ ...base, tool: "write", input: {} })).toEqual({ allow: false, reason: "no answer from the operator within 0 min — denied" });
  expect(settled).toEqual(["t1"]);
  const { gate: g2 } = makeGate();
  const p = g2.check({ ...base, tool: "write", input: {} });
  g2.cancelAll("cockpit closing");
  expect(await p).toEqual({ allow: false, reason: "cockpit closing" });
});

test("a throwing guard blocks; a non-string command is checked as empty", async () => {
  const gate = new Gate({ ask: () => {}, guard: () => { throw new Error("boom"); } });
  expect(await gate.check({ ...base, tool: "bash", input: { command: "ls" } })).toEqual({ allow: false, reason: "org-os vault guard failed (boom); blocking fail-closed" });
  const seen: string[] = [];
  const g2 = new Gate({ ask: () => {}, guard: (cmd) => { seen.push(cmd); return { allow: false, reason: "x" }; } });
  await g2.check({ ...base, tool: "bash", input: { command: 42 as unknown as string } });
  expect(seen).toEqual([""]);
});

test("the real guard is the default", async () => {
  const gate = new Gate({ ask: () => {} });
  const d = await gate.check({ ...base, tool: "bash", input: { command: DANGEROUS } });
  expect(d.allow).toBe(false);
});

test("summaries", () => {
  expect(summarizeTool("bash", { command: "npm test\nmore" })).toBe("npm test");
  expect(summarizeTool("write", { path: "docs/a.md", content: "x" })).toBe("docs/a.md");
  expect(summarizeTool("custom", { a: 1 })).toBe('{"a":1}');
});
