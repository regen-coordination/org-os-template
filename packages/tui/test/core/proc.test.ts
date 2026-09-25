import { test, expect } from "bun:test";
import { run, which } from "../../src/core/proc";

test("captures output and exit code", async () => {
  const r = await run("sh", ["-c", "echo out; echo err >&2; exit 3"]);
  expect(r.code).toBe(3);
  expect(r.stdout.trim()).toBe("out");
  expect(r.stderr.trim()).toBe("err");
});

test("feeds stdin", async () => {
  const r = await run("cat", [], { input: "hello" });
  expect(r.stdout).toBe("hello");
});

test("times out", async () => {
  const r = await run("sleep", ["5"], { timeoutMs: 150 });
  expect(r.timedOut).toBe(true);
  expect(r.code).not.toBe(0);
});

test("missing binary is an error, not a throw", async () => {
  const r = await run("definitely-not-a-binary-xyz", []);
  expect(r.code).toBe(null);
  expect(r.error).toBeTruthy();
});

test("which", () => {
  expect(which("sh")).toBe(true);
  expect(which("definitely-not-a-binary-xyz")).toBe(false);
});
