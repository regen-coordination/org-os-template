import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkspaceFiles, listMemoryFiles, ROOT_FILES, WATCH_PATHS } from "../read-files.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("readWorkspaceFiles reads known root files and dated memory logs only", () => {
  const { files, errors } = readWorkspaceFiles(join(FIX, "ws"));
  assert.deepEqual(errors, []);
  assert.ok(files["HEARTBEAT.md"].includes("Submit grant report"));
  assert.ok(files["package.json"]);
  assert.ok(files["memory/2026-09-02.md"]);
  assert.equal(files["memory/README.md"], undefined);
  assert.equal(files["MEMORY.md"], undefined);
});

test("memory files are newest first and limited", () => {
  assert.deepEqual(listMemoryFiles(join(FIX, "ws")), ["memory/2026-09-02.md", "memory/2026-09-01.md"]);
  assert.deepEqual(listMemoryFiles(join(FIX, "ws"), 1), ["memory/2026-09-02.md"]);
  assert.deepEqual(listMemoryFiles(join(FIX, "does-not-exist")), []);
});

test("constants cover what the loaders and the watcher need", () => {
  for (const p of ["package.json", "HEARTBEAT.md", "DECISIONS.md", "federation.yaml", "data/funding-opportunities.yaml"]) assert.ok(ROOT_FILES.includes(p), p);
  for (const p of ["data", "memory", "HEARTBEAT.md"]) assert.ok(WATCH_PATHS.includes(p), p);
});
