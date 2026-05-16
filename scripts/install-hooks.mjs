#!/usr/bin/env node
/**
 * install-hooks.mjs — install git hooks from .github/hooks/ into .git/hooks/.
 *
 * Operator runs once per clone (or whenever hooks change). Idempotent.
 *
 * Usage:
 *   npm run install:hooks
 *   npm run install:hooks -- --uninstall
 */

import { readFileSync, writeFileSync, chmodSync, existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const uninstall = process.argv.includes("--uninstall");

const gitDir = (() => {
  try {
    return execSync("git rev-parse --git-dir", { cwd: rootDir, encoding: "utf-8" }).trim();
  } catch {
    console.error("✗ Not a git repository (or git not available)");
    process.exit(1);
  }
})();

const hooksSourceDir = path.join(rootDir, ".github", "hooks");
const hooksTargetDir = path.resolve(rootDir, gitDir, "hooks");

const hooks = [
  { source: "pre-commit.sh", target: "pre-commit" },
];

let installedCount = 0;
let uninstalledCount = 0;
let skippedCount = 0;

for (const { source, target } of hooks) {
  const sourcePath = path.join(hooksSourceDir, source);
  const targetPath = path.join(hooksTargetDir, target);

  if (uninstall) {
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
      console.log(`✓ removed ${path.relative(rootDir, targetPath)}`);
      uninstalledCount++;
    } else {
      console.log(`· ${path.relative(rootDir, targetPath)} (not present)`);
      skippedCount++;
    }
    continue;
  }

  if (!existsSync(sourcePath)) {
    console.error(`✗ source missing: ${path.relative(rootDir, sourcePath)}`);
    process.exit(1);
  }

  const content = readFileSync(sourcePath, "utf-8");
  writeFileSync(targetPath, content);
  chmodSync(targetPath, 0o755);
  console.log(`✓ installed ${path.relative(rootDir, targetPath)} from ${source}`);
  installedCount++;
}

if (uninstall) {
  console.log(`\n${uninstalledCount} hook(s) removed, ${skippedCount} skipped.`);
  console.log("Reinstall: npm run install:hooks");
} else {
  console.log(`\n${installedCount} hook(s) installed.`);
  console.log("Test:  echo 'noop' >> /tmp/test && git add /tmp/test  # check is local; this is illustrative");
  console.log("Bypass (use sparingly): git commit --no-verify");
}
