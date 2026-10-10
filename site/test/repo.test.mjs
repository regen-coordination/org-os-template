// site/test/repo.test.mjs — runs from site/ (npm test), inside a git checkout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, REPO_URL, VERSION, RELEASE_REF, listRepoFiles, commitExists } from "../src/lib/repo.mjs";

test("the root is the repository, not the site folder", () => {
  assert.ok(existsSync(join(REPO_ROOT, "federation.yaml")));
  assert.ok(existsSync(join(REPO_ROOT, "site", "astro.config.mjs")));
});

test("version and ref come from the root package.json", () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
  assert.equal(RELEASE_REF, `v${VERSION}`);
  assert.equal(REPO_URL, "https://github.com/regen-coordination/org-os-template");
});

test("the file list is repo-relative, uses forward slashes and skips ignored files", () => {
  const files = listRepoFiles();
  assert.ok(files.includes("docs/SETUP.md"));
  assert.ok(files.includes("site/astro.config.mjs"));
  assert.ok(!files.some((f) => f.includes("node_modules/")));
  assert.ok(!files.some((f) => f.includes("\\")));
});

test("commitExists tells a real commit from a made-up one", () => {
  assert.equal(commitExists("HEAD"), true);
  assert.equal(commitExists("0000000000000000000000000000000000000000"), false);
});
