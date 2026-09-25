import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Gate } from "../../src/core/gate";
import { extraSkillPaths, mapPiEvent, piBackend, piPackageResources } from "../../src/core/agents/pi";
import type { AgentEvent, PermissionRequest, WorkspaceInfo } from "../../src/core/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMEWORK = resolve(HERE, "../../../..");
const DANGEROUS = ["git", "stash", "list"].join(" ");

async function setup(responses: any[], answer?: "once" | "deny") {
  const agentDir = mkdtempSync(join(tmpdir(), "ck-pi-agent-"));
  const root = mkdtempSync(join(tmpdir(), "ck-pi-ws-"));
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  faux.setResponses(responses);
  const asked: PermissionRequest[] = [];
  const gate: Gate = new Gate({
    ask: (r) => {
      asked.push(r);
      if (answer) setTimeout(() => gate.answer(r.id, answer), 10);
    },
  });
  const backend = piBackend({
    frameworkRoot: FRAMEWORK,
    agentDir,
    persistent: false,
    model: faux.getModel(),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false }, compaction: { enabled: false } }),
    extraFactories: [(pi: any) => pi.registerProvider(faux.provider)],
  });
  const workspace: WorkspaceInfo = { id: "t", label: "t", root, kind: "extra", exists: true, drift: 0 };
  const session = await backend.open({ workspace, resume: "new", gate });
  const events: AgentEvent[] = [];
  session.subscribe((e) => events.push(e));
  return { session, events, asked, root };
}

test("the vault guard blocks a destructive shell call without asking", async () => {
  const { session, events, asked } = await setup([
    fauxAssistantMessage(fauxToolCall("bash", { command: DANGEROUS }), { stopReason: "toolUse" }),
    fauxAssistantMessage("stopped"),
  ]);
  await session.prompt("go");
  const end = events.find((e) => e.type === "tool_end");
  expect(end).toMatchObject({ type: "tool_end", ok: false });
  expect(end && end.type === "tool_end" && end.summary).toContain("BLOCKED");
  expect(asked.length).toBe(0);
  expect(events.some((e) => e.type === "notice" && e.text.includes("pi-harness"))).toBe(true);
  expect(events.filter((e) => e.type === "assistant_end").at(-1)).toEqual({ type: "assistant_end", text: "stopped" });
  expect(events.at(-1)).toEqual({ type: "status", status: "idle" });
  await session.dispose();
});

test("a write asks the operator; allow once writes the file", async () => {
  const { session, events, asked, root } = await setup([
    fauxAssistantMessage(fauxToolCall("write", { path: "note.txt", content: "hi" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ], "once");
  await session.prompt("write it", "write a note");
  expect(asked.map((a) => [a.tool, a.summary])).toEqual([["write", "note.txt"]]);
  expect(existsSync(join(root, "note.txt"))).toBe(true);
  expect(events.find((e) => e.type === "user")).toEqual({ type: "user", text: "write a note" });
  expect(events.find((e) => e.type === "tool_end")).toMatchObject({ ok: true });
  await session.dispose();
});

test("deny keeps the file from being written", async () => {
  const { session, root } = await setup([
    fauxAssistantMessage(fauxToolCall("write", { path: "no.txt", content: "x" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("ok"),
  ], "deny");
  await session.prompt("write it");
  expect(existsSync(join(root, "no.txt"))).toBe(false);
  await session.dispose();
});

test("a model error surfaces as a notice", async () => {
  const { session, events } = await setup([fauxAssistantMessage("", { stopReason: "error", errorMessage: "boom" })]);
  await session.prompt("hi");
  expect(events.some((e) => e.type === "notice" && e.level === "error" && e.text.includes("boom"))).toBe(true);
  await session.dispose();
});

test("mapPiEvent", () => {
  expect(mapPiEvent({ type: "agent_start" })).toEqual([{ type: "status", status: "working" }]);
  expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x" } })).toEqual([{ type: "text_delta", delta: "x" }]);
  expect(mapPiEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x" } })).toEqual([]);
  expect(mapPiEvent({ type: "message_end", message: { role: "user", content: "x" } })).toEqual([]);
  expect(mapPiEvent({ type: "tool_execution_start", toolCallId: "1", toolName: "read", args: { path: "a.md" } })).toEqual([{ type: "tool_start", callId: "1", tool: "read", summary: "a.md" }]);
  expect(mapPiEvent({ type: "tool_execution_end", toolCallId: "1", toolName: "read", isError: false, result: { content: [{ type: "text", text: "line1\nline2" }] } })).toEqual([{ type: "tool_end", callId: "1", ok: true, summary: "line1" }]);
  expect(mapPiEvent({ type: "turn_end" })).toEqual([]);
});

test("pi package manifest and extra skill paths", () => {
  const pkg = join(HERE, "../fixtures/pi-package");
  expect(piPackageResources(pkg)).toEqual({
    extensions: [join(pkg, "extensions/org-os/index.ts"), join(pkg, "extensions/vault-guard.ts")],
    skills: [join(pkg, "skills")],
    prompts: [join(pkg, "prompts")],
  });
  expect(piPackageResources("/does/not/exist")).toEqual({ extensions: [], skills: [], prompts: [] });
  const root = mkdtempSync(join(tmpdir(), "ck-skills-"));
  expect(extraSkillPaths(root)).toEqual([]);
  mkdirSync(join(root, "skills"));
  expect(extraSkillPaths(root)).toEqual([join(root, "skills")]);
  mkdirSync(join(root, ".pi"));
  writeFileSync(join(root, ".pi", "settings.json"), JSON.stringify({ skills: ["../skills", "!../skills/commands/**"] }));
  expect(extraSkillPaths(root)).toEqual([]);
});
