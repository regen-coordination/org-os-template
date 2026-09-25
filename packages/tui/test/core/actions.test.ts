import { test, expect } from "bun:test";
import { actionsFor, findAction, runScript, editorCommand, SCRIPT_ALLOWLIST } from "../../src/core/actions";
import type { Runner } from "../../src/core/proc";

const ws: any = { info: { root: "/ws" }, files: { "package.json": JSON.stringify({ scripts: { initialize: "x", "validate:schemas": "y", deploy: "z" } }) } };

test("catalog: open, lifecycle, launch, and only allow-listed scripts that exist", () => {
  const list = actionsFor(ws);
  const ids = list.map((a) => a.id);
  expect(ids).toContain("open-source");
  expect(ids).toContain("agent:close");
  expect(ids).toContain("launch:claude:split");
  expect(ids).toContain("launch:opencode:tab");
  expect(ids).toContain("script:initialize");
  expect(ids).toContain("script:validate:schemas");
  expect(ids).not.toContain("script:deploy");
  expect(findAction(list, "agent:close")).toMatchObject({ kind: "agent", command: "close" });
  expect(actionsFor(null).some((a) => a.kind === "script")).toBe(false);
});

test("runScript refuses non-allow-listed scripts and runs allowed ones", async () => {
  const calls: string[][] = [];
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { code: 0, stdout: "ok\n", stderr: "" };
  };
  expect(await runScript("/ws", "deploy", run)).toEqual({ ok: false, output: "script not allowed: deploy" });
  expect(await runScript("/ws", "initialize", run)).toEqual({ ok: true, output: "ok" });
  expect(calls).toEqual([["npm", "run", "--silent", "initialize"]]);
  expect(SCRIPT_ALLOWLIST).toContain("validate:structure");
});

test("editorCommand", () => {
  expect(editorCommand({ EDITOR: "nvim -p" }, "/f")).toEqual({ cmd: "nvim", args: ["-p", "/f"] });
  expect(editorCommand({ VISUAL: "code -w", EDITOR: "vi" }, "/f")).toEqual({ cmd: "code", args: ["-w", "/f"] });
  expect(editorCommand({}, "/f")).toEqual({ cmd: "vi", args: ["/f"] });
});
