import { test, expect } from "bun:test";
import { expandCommand, parseSlash, stripFrontmatter } from "../../src/core/commands";
import { makeFleetFixture } from "../helpers/fixtures";

test("stripFrontmatter", () => {
  expect(stripFrontmatter("---\na: 1\n---\nbody")).toBe("body");
  expect(stripFrontmatter("no front")).toBe("no front");
});

test("expands from the workspace, falling back to the framework", async () => {
  const { fw, instA } = makeFleetFixture();
  const r = await expandCommand(instA, "close", "today", { fallbackRoot: fw });
  expect(r).toEqual({ ok: true, text: "Close the session for today now.", source: `${fw}/.claude/commands/close.md` });
  const missing = await expandCommand(instA, "sync", "", { fallbackRoot: fw });
  expect(missing.ok).toBe(false);
});

test("parseSlash only accepts lifecycle commands", () => {
  expect(parseSlash("/close wrap up")).toEqual({ name: "close", args: "wrap up" });
  expect(parseSlash("  /initialize ")).toEqual({ name: "initialize", args: "" });
  expect(parseSlash("/deploy now")).toBe(null);
  expect(parseSlash("close")).toBe(null);
});
