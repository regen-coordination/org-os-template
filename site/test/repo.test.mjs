// site/test/repo.test.mjs — runs from site/ (npm test), inside a git checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT, REPO_URL, VERSION, SOURCE_REF, listRepoFiles, commitExists } from "../src/lib/repo.mjs";

test("the root is the repository, not the site folder", () => {
  assert.ok(existsSync(join(REPO_ROOT, "federation.yaml")));
  assert.ok(existsSync(join(REPO_ROOT, "site", "astro.config.mjs")));
});

test("version comes from the root package.json; the source ref is a commit id", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
  assert.match(SOURCE_REF, /^[0-9a-f]{40}$/);
  assert.equal(commitExists(SOURCE_REF), true);
  assert.equal(REPO_URL, "https://github.com/regen-coordination/org-os-template");
});

test("the file list is repo-relative, uses forward slashes and skips ignored files", () => {
  const files = listRepoFiles();
  assert.ok(files.includes("docs/SETUP.md"));
  assert.ok(files.includes("site/astro.config.mjs"));
  assert.ok(!files.some((f) => f.includes("node_modules/")));
  assert.ok(!files.some((f) => f.includes("\\")));
});

test("only tracked files are listed", () => {
  const tracked = execFileSync("git", ["ls-files", "--cached", "-z"], { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\0").filter(Boolean);
  assert.equal(listRepoFiles().length, tracked.length);
  const set = new Set(tracked);
  assert.ok(listRepoFiles().every((f) => set.has(f)));
});

test("commitExists tells a real commit from a made-up one", () => {
  assert.equal(commitExists("HEAD"), true);
  assert.equal(commitExists("0000000000000000000000000000000000000000"), false);
  const root = execFileSync("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n")[0];
  assert.equal(commitExists(root), true);
});
