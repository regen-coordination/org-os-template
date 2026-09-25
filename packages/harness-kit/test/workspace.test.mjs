import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspace, readWorkspaceName, findWorkspace, findEnclosingWorkspace } from "../workspace.mjs";

function makeWs(dir, federation) {
  mkdirSync(join(dir, "data"), { recursive: true });
  mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(dir, "package.json"), "{}");
  writeFileSync(join(dir, "federation.yaml"), federation ?? 'identity:\n  name: "Test Org"\n');
}

test("isWorkspace requires all four markers", () => {
  const d = mkdtempSync(join(tmpdir(), "hk-"));
  assert.equal(isWorkspace(d), false);
  makeWs(d);
  assert.equal(isWorkspace(d), true);
});

test("readWorkspaceName reads identity.name in its common shapes", () => {
  const cases = [
    ['identity:\n  name: "org-os"\n  type: "Project"\n', "org-os"],
    ["identity:\n  name: LF Zettelkasten OS\n", "LF Zettelkasten OS"],
    ["identity:\n  emoji: x\n  name: 'Quoted'   # comment\n", "Quoted"],
    ["identity:\n  onchain_registration:\n    name: nested\n  name: Real\n", "Real"],
    ["network: x\nname: top-level-is-ignored\n", null],
  ];
  for (const [yaml, expected] of cases) {
    const d = mkdtempSync(join(tmpdir(), "hk-name-"));
    writeFileSync(join(d, "federation.yaml"), yaml);
    const name = readWorkspaceName(d);
    assert.equal(name, expected ?? d.split("/").pop(), yaml);
  }
  const missing = mkdtempSync(join(tmpdir(), "hk-nofed-"));
  assert.equal(readWorkspaceName(missing), missing.split("/").pop());
});

test("findWorkspace walks up; findEnclosingWorkspace skips the root itself", () => {
  const hub = mkdtempSync(join(tmpdir(), "hk-hub-"));
  makeWs(hub, "identity:\n  name: Hub\n");
  const fw = join(hub, "libs", "fw");
  makeWs(fw, "identity:\n  name: Framework\n");
  const deep = join(fw, "packages", "x", "src");
  mkdirSync(deep, { recursive: true });
  assert.deepEqual(findWorkspace(deep), { root: fw, name: "Framework" });
  assert.deepEqual(findEnclosingWorkspace(fw), { root: hub, name: "Hub" });
  assert.equal(findEnclosingWorkspace(hub), null);
  const lone = mkdtempSync(join(tmpdir(), "hk-lone-"));
  assert.equal(findWorkspace(lone), null);
});
