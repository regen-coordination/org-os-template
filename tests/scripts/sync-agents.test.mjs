// tests/scripts/sync-agents.test.mjs
//
// Tests for scripts/sync-agents.mjs (Berd agent integration). Fixtures build
// a source dir (stands in for <repo>/.agents/agents/) and a target dir
// (stands in for ~/.agents/agents/) in temp dirs; the real script is spawned
// with --source/--target so nothing outside the fixture is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { ORG_ROOT } from "../helpers/repo-paths.mjs";
const SCRIPT = path.join(ORG_ROOT, "scripts", "sync-agents.mjs");

const MANAGED_AGENT = (body = "You are Testa.") =>
  `---\nname: Testa\ndescription: A test agent.\nmanaged_by: org-os\n---\n\n${body}\n`;

function setup({ sourceFiles = {}, targetFiles = {}, bundled = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sync-agents-"));
  const source = path.join(root, "source");
  const target = path.join(root, "target");
  mkdirSync(source, { recursive: true });
  mkdirSync(target, { recursive: true });
  for (const [file, content] of Object.entries(sourceFiles))
    writeFileSync(path.join(source, file), content);
  for (const [file, content] of Object.entries(targetFiles))
    writeFileSync(path.join(target, file), content);
  if (bundled)
    writeFileSync(
      path.join(target, ".berd-bundled-agents.json"),
      JSON.stringify({ seededFiles: bundled }),
    );
  return { source, target };
}

function run(source, target, ...flags) {
  return spawnSync(
    "node",
    [SCRIPT, "--source", source, "--target", target, ...flags],
    { encoding: "utf-8", cwd: ORG_ROOT },
  );
}

test("installs a new agent into the target verbatim", () => {
  const content = MANAGED_AGENT();
  const { source, target } = setup({ sourceFiles: { "testa.md": content } });
  const r = run(source, target);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(target, "testa.md"), "utf-8"), content);
  assert.match(r.stdout, /installed/);
});

test("creates the target directory when it does not exist", () => {
  const { source, target } = setup({
    sourceFiles: { "testa.md": MANAGED_AGENT() },
  });
  const fresh = path.join(target, "nested", "agents");
  const r = run(source, fresh);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(fresh, "testa.md")));
});

test("updates a target file that is managed by org-os", () => {
  const next = MANAGED_AGENT("You are Testa, v2.");
  const { source, target } = setup({
    sourceFiles: { "testa.md": next },
    targetFiles: { "testa.md": MANAGED_AGENT("You are Testa, v1.") },
  });
  const r = run(source, target);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(target, "testa.md"), "utf-8"), next);
  assert.match(r.stdout, /updated/);
});

test("reports an identical managed target as unchanged", () => {
  const content = MANAGED_AGENT();
  const { source, target } = setup({
    sourceFiles: { "testa.md": content },
    targetFiles: { "testa.md": content },
  });
  const r = run(source, target);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /unchanged/);
});

test("refuses to overwrite a hand-authored (unmanaged) target file", () => {
  const handAuthored = `---\nname: Testa\ndescription: Hand-tuned.\n---\n\nMy own version.\n`;
  const { source, target } = setup({
    sourceFiles: { "testa.md": MANAGED_AGENT() },
    targetFiles: { "testa.md": handAuthored },
  });
  const r = run(source, target);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(path.join(target, "testa.md"), "utf-8"),
    handAuthored,
  );
  assert.match(r.stdout, /skipped.*--adopt/s);
});

test("--adopt takes over an unmanaged target file", () => {
  const next = MANAGED_AGENT();
  const { source, target } = setup({
    sourceFiles: { "testa.md": next },
    targetFiles: {
      "testa.md": `---\nname: Testa\ndescription: Hand-tuned.\n---\n\nMine.\n`,
    },
  });
  const r = run(source, target, "--adopt");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(target, "testa.md"), "utf-8"), next);
  assert.match(r.stdout, /adopted/);
});

test("never touches a Berd-bundled agent, even with --adopt", () => {
  const bundledContent = `---\nname: Tinker\ndescription: Berd bundled.\n---\n\nBundled body.\n`;
  const { source, target } = setup({
    sourceFiles: { "tinker.md": MANAGED_AGENT() },
    targetFiles: { "tinker.md": bundledContent },
    bundled: ["tinker.md"],
  });
  const r = run(source, target, "--adopt");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(
    readFileSync(path.join(target, "tinker.md"), "utf-8"),
    bundledContent,
  );
  assert.match(r.stdout, /bundled/);
});

test("fails on a source agent missing required frontmatter", () => {
  const { source, target } = setup({
    sourceFiles: {
      "bad.md": `---\nname: Bad\nmanaged_by: org-os\n---\n\nNo description.\n`,
    },
  });
  const r = run(source, target);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /description/);
  assert.ok(!existsSync(path.join(target, "bad.md")));
});

test("fails on a source agent missing the managed_by marker", () => {
  const { source, target } = setup({
    sourceFiles: {
      "unmarked.md": `---\nname: Unmarked\ndescription: No marker.\n---\n\nBody.\n`,
    },
  });
  const r = run(source, target);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /managed_by/);
  assert.ok(!existsSync(path.join(target, "unmarked.md")));
});

test("--dry-run reports actions without writing", () => {
  const { source, target } = setup({
    sourceFiles: { "testa.md": MANAGED_AGENT() },
  });
  const r = run(source, target, "--dry-run");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(path.join(target, "testa.md")));
  assert.match(r.stdout, /would install/);
});
