// A fresh checkout builds, or says in one sentence which install is missing and
// the command that fixes it. The site needs three installs (the repository root,
// the federation map package, the site itself); with one missing the build used
// to stop on a Node stack trace naming a file in another package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_INSTALLS, missingInstalls, installMessage } from "../scripts/installs.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..");

// A repository with only the given installs done (each named by its directory).
function fakeRepo(installed) {
  const root = mkdtempSync(join(tmpdir(), "org-os-installs-"));
  for (const install of REQUIRED_INSTALLS) {
    if (!installed.includes(install.dir)) continue;
    const probe = join(root, install.dir, install.probe);
    mkdirSync(dirname(probe), { recursive: true });
    writeFileSync(probe, "{}");
  }
  return root;
}

test("the three installs are listed in the order CI runs them", () => {
  assert.deepEqual(REQUIRED_INSTALLS.map((i) => i.dir), [".", "packages/org-os-federation-map", "site"]);
});

test("with nothing installed, all three are reported, in order", () => {
  const root = fakeRepo([]);
  try {
    assert.deepEqual(missingInstalls(root).map((i) => i.dir), [".", "packages/org-os-federation-map", "site"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("with only the federation map and the site installed, the root install is reported", () => {
  const root = fakeRepo(["packages/org-os-federation-map", "site"]);
  try {
    const missing = missingInstalls(root);
    assert.deepEqual(missing.map((i) => i.dir), ["."]);
    const message = installMessage(missing, root);
    assert.match(message, /repository root/);
    assert.match(message, /js-yaml/);
    assert.ok(message.includes(`cd "${root}" && npm ci`), message);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("with all three installed, nothing is reported", () => {
  const root = fakeRepo([".", "packages/org-os-federation-map", "site"]);
  try {
    assert.deepEqual(missingInstalls(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the aggregator checks the installs before it imports anything that needs one", () => {
  const source = readFileSync(join(SITE, "scripts", "aggregate-federation.mjs"), "utf8");
  const staticImports = [...source.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(staticImports.length > 0, "no static import found: the pattern stopped matching");
  for (const specifier of staticImports) {
    assert.ok(
      specifier.startsWith("node:") || specifier === "./installs.mjs",
      `aggregate-federation.mjs imports "${specifier}" statically; a missing install would fail there with a stack trace, before the check can speak`,
    );
  }
});

test("run without any install, the aggregator says what is missing and prints no stack trace", () => {
  const root = mkdtempSync(join(tmpdir(), "org-os-installs-run-"));
  try {
    cpSync(join(SITE, "scripts"), join(root, "site", "scripts"), { recursive: true });
    const run = spawnSync(process.execPath, [join(root, "site", "scripts", "aggregate-federation.mjs")], { encoding: "utf8" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /The install at the repository root is missing/);
    assert.match(run.stderr, /npm ci/);
    assert.doesNotMatch(run.stderr, /ERR_MODULE_NOT_FOUND|^\s+at /m);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("site/README.md names the three installs in the order CI runs them", () => {
  const lines = readFileSync(join(SITE, "README.md"), "utf8").split("\n");
  const positions = REQUIRED_INSTALLS.map((i) => lines.findIndex((line) => line.startsWith(i.readme)));
  for (const [n, at] of positions.entries()) {
    assert.ok(at !== -1, `site/README.md has no line starting with: ${REQUIRED_INSTALLS[n].readme}`);
  }
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "the installs are out of order in site/README.md");
});

test("the deploy workflow installs the same three, in the same order", () => {
  const workflow = readFileSync(join(REPO, ".github", "workflows", "deploy-pages.yml"), "utf8");
  const steps = workflow.split(/\n\s+- name: /).filter((s) => /\n\s+run: npm ci\b/.test(s));
  const dirs = steps.map((s) => s.match(/working-directory: (\S+)/)?.[1] ?? ".");
  assert.deepEqual(dirs, REQUIRED_INSTALLS.map((i) => i.dir));
});
